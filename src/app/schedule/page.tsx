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

/* og:image 는 그 주가 **발행돼 있을 때만** 실제 PNG 를 가리킨다 — 결정 13 은 미발행이 공유
   카드로 안 나가는 것까지 포함하므로, 초안뿐인 주는 사이트 기본 커버(OG_IMAGE)로 조용히
   떨어진다. `rev`(주 메타 revision)를 실어 보내 og/schedule 라우트가 영구 캐싱해도 되는
   URL을 받게 한다(그 라우트의 Cache-Control 주석 참고). */
async function resolveOgImage(weekStart: string) {
  const week = await getPublishedWeekCached(weekStart);
  if (!week) return OG_IMAGE;
  return {
    url: `/api/og/schedule?week=${weekStart}&rev=${week.revision}`,
    width: 1200,
    height: 630,
    alt: `챠이로 쿠냐 ${weekStart} 주 방송 일정표`,
  };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}): Promise<Metadata> {
  const { week } = await searchParams;
  const weekStart = resolveWeekParam(week);
  return {
    title: TITLE,
    description: "챠이로 쿠냐의 이번 주 방송 일정.",
    openGraph: {
      siteName: OG_SITE_NAME,
      locale: OG_LOCALE,
      type: "website",
      images: [await resolveOgImage(weekStart)],
      url: "/schedule",
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
  const currentWeek = weekStartOf(todayKST());

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
      />
    </main>
  );
}
