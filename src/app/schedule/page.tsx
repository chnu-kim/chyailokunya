import type { Metadata } from "next";
import "./schedule.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isIsoDate, toIsoDate, todayKST, weekStartOf } from "@/core/calendar";
import { makeDb } from "@/db";
import { listGameOptions } from "@/features/games/service";
import { getPublishedWeek, getWeekForEdit } from "@/features/schedule/service";
import { getServerActor, getServerAuthorities } from "../server-session";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "../site-meta";
import { ScheduleEditor } from "./schedule-editor";
import { ScheduleReadView } from "./schedule-read";

export const metadata: Metadata = {
  title: "챠이로 쿠냐 — 주간 일정",
  description: "챠이로 쿠냐의 이번 주 방송 일정.",
  openGraph: {
    siteName: OG_SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
    images: [OG_IMAGE],
    url: "/schedule",
    title: "챠이로 쿠냐 — 주간 일정",
    description: "챠이로 쿠냐의 이번 주 방송 일정. 언제 뭘 하는지 여기서 확인해요.",
  },
};

/* 요청 스코프의 D1 바인딩을 읽으므로 정적 프리렌더 대상이 아니다 — force-dynamic 으로 빌드가
   미리 렌더하려다 바인딩을 못 찾고 깨지는 걸 막는다(게임 보드와 같은 이유). */
export const dynamic = "force-dynamic";

/* ?week= 는 그 주의 아무 날이나 받아 월요일로 정규화한다(주는 날짜에서 유도, 결정 2). 형식이
   틀리거나 실재하지 않는 날이면 조용히 이번 주로 — 위조 링크를 눌러도 화면이 깨지지 않는다
   (safeReturnTo 와 같은 "버리고 기본값" 규율). */
function resolveWeek(param: string | undefined): string {
  if (param && isIsoDate(param)) return weekStartOf(toIsoDate(param));
  return weekStartOf(todayKST());
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weekStart = resolveWeek(week);
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
    getPublishedWeek(db, weekStart),
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
