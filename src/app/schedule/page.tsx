import type { Metadata } from "next";
import "./schedule.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import { resolveWeekParam, todayKST, weekStartOf } from "@/core/calendar";
import { makeDb } from "@/db";
import { listGameOptions } from "@/features/games/service";
import { getPublishedWeek, getWeekForEdit } from "@/features/schedule/service";
import { getServerActor, getServerAuthorities } from "../server-session";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "../site-meta";
import { ScheduleEditor } from "./schedule-editor";
import { ScheduleReadView } from "./schedule-read";

const TITLE = "챠이로 쿠냐 — 주간 일정";
const OG_DESCRIPTION = "챠이로 쿠냐의 이번 주 방송 일정. 언제 뭘 하는지 여기서 확인합니다.";

/* 요청 스코프의 D1 바인딩을 읽으므로 정적 프리렌더 대상이 아니다 — force-dynamic 으로 빌드가
   미리 렌더하려다 바인딩을 못 찾고 깨지는 걸 막는다(게임 보드와 같은 이유). */
export const dynamic = "force-dynamic";

/* generateMetadata 와 페이지 본문(비로그인 분기)이 같은 주의 발행 뷰를 각자 부른다 — react
   cache() 로 한 요청 안에서 D1 왕복을 하나로 접는다(getServerActor 와 같은 이유·같은 패턴). */
const getPublishedWeekCached = cache(async (weekStart: string) => {
  const db = makeDb(getCloudflareContext().env.DB);
  return getPublishedWeek(db, weekStart);
});

/* og:image 는 주별 동적 PNG 를 다시 가리키지 않는다 — 항상 사이트 기본 커버(OG_IMAGE)다.
   2026-07-27 프로덕션 인시던트로 되돌렸다: Satori/resvg 서버 렌더가 Cloudflare Workers 무료
   플랜의 요청당 CPU 10ms 한도를 구조적으로 못 지켜(고정 비용 자체가 한도 초과), 발행된 주의
   og:image URL 을 소셜 크롤러가 자동으로 두드릴 때마다 그 isolate 가 CPU 한도를 넘겨 죽고,
   같은 isolate 를 타던 무관한 요청(favicon.ico 까지)도 연쇄로 실패했다(Error 1102, 실측
   `wrangler tail`). `/api/og/schedule` 라우트 자체를 지웠다 — 이슈 #56 결정 15("PNG = Worker
   서버 렌더, og:image 겸용")를 잠정 철회한다. 다음 계획은 og:image 자동 링크가 아니라
   **클라이언트 사이드**(방문자 브라우저) 렌더 + 수동 다운로드로, 별도 이슈에서 다룬다. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}): Promise<Metadata> {
  const { week } = await searchParams;
  const weekStart = resolveWeekParam(week);
  /* `week` 이 명시된 요청만 그 주로 못박는다 — 명시가 없는 맨 `/schedule` 은 계속 "지금 주"라는
     움직이는 과녁이어야 한다(원래 동작). 여기서 `weekStart`(정규화된 값)로 무조건 못박으면
     맨 URL 공유도 그 순간의 주에 영영 고정돼, 다음 주가 되어도 크롤러가 캐싱해 둔 카드가 지난
     주를 계속 가리킨다 — og:image 는 이미 주별로 다른데 og:url 만 그대로면(적대적 리뷰 지적)
     같은 canonical 아래 서로 다른 주의 카드가 뒤섞여 플랫폼이 미리보기를 잘못 중복 제거하거나
     클릭 시 엉뚱한 주로 보낸다. */
  const canonicalUrl = week !== undefined ? `/schedule?week=${weekStart}` : "/schedule";
  return {
    title: TITLE,
    description: "챠이로 쿠냐의 이번 주 방송 일정.",
    openGraph: {
      siteName: OG_SITE_NAME,
      locale: OG_LOCALE,
      type: "website",
      images: [OG_IMAGE],
      url: canonicalUrl,
      title: TITLE,
      description: OG_DESCRIPTION,
    },
  };
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weekStart = resolveWeekParam(week);
  /* 오늘과 이번 주를 **한 번의** todayKST() 에서 같이 낸다 — 두 번 부르면 자정 직전 요청에서
     서로 다른 날을 볼 수 있고, 그러면 "이번 주"인데 오늘 칸이 없는 화면이 나온다. 클라이언트가
     todayKST 를 다시 부르지 않는 이유는 WeekNav 주석과 같다(SSR 과 갈리면 하이드레이션이 튄다). */
  const today = todayKST();
  const currentWeek = weekStartOf(today);

  const db = makeDb(getCloudflareContext().env.DB);
  // 신원(쓰기 권한)에 따라 서버가 다른 뷰를 준다 — 관리자는 초안 포함 편집용, 그 외엔 발행된
  // 주만. UI 분기는 편의가 아니라 여기서 데이터 자체가 갈린다(초안 항목이 공개 HTML 로 안 샌다).
  const authorities = await getServerActor().then(getServerAuthorities);
  const canWrite = authorities.has("schedule:write");

  if (canWrite) {
    const [weekView, games] = await Promise.all([
      getWeekForEdit(db, weekStart),
      listGameOptions(db),
    ]);
    return (
      <main id="main">
        {/* key 로 주가 바뀌면 편집기를 remount 한다 — 안 하면 주 이동(WeekNav 의 client 네비)이
            새 weekStartDate·initialWeek 을 prop 으로 주지만 편집기가 보존돼 useState 초기화가
            재실행되지 않는다. 그러면 옛 주의 draft(note·published·항목)가 새 주 화면에 남고,
            저장이 새 weekStartDate 로 나가 옛 주 상태를 새 주에 덮어쓴다. remount 로 새 주의
            initialWeek 에서 draft·baseline 이 깨끗하게 다시 선다. */}
        <ScheduleEditor
          key={weekStart}
          weekStartDate={weekStart}
          initialWeek={weekView}
          games={games}
          currentWeek={currentWeek}
        />
      </main>
    );
  }

  const [weekView, games] = await Promise.all([
    getPublishedWeekCached(weekStart),
    listGameOptions(db),
  ]);
  return (
    <main id="main">
      <ScheduleReadView
        weekStartDate={weekStart}
        week={weekView}
        games={games}
        currentWeek={currentWeek}
        today={today}
      />
    </main>
  );
}
