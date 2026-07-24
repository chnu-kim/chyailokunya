"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toIsoDate, WEEKDAY_LABELS, weekDates } from "@/core/calendar";
import {
  addEntry,
  draftEntryInputs,
  entriesForDate,
  isWeekDirty,
  makeDraftEntry,
  newEntryKey,
  removeEntry,
  updateEntry,
  type WeekDraft,
} from "@/core/schedule-editor";
import type { GameOption } from "@/features/games/service";
import type { WeekView } from "@/features/schedule/service";
import { trpc } from "@/features/trpc/client";
import { isAborted, REQUEST_TIMEOUT_MS } from "../games/error-message";
import { formatMD, WeekNav } from "./schedule-shared";

/* 주간 일괄 편집기(이슈 #56 작업순서 6, 결정 12·14). PR #59 가 games.played_at 을 드롭하며 없앤
   "라이브에서 게임 플레이 날짜 배정"을 되살리는 화면이다 — 관리자가 한 주를 통째로 짜서 저장하면
   그 항목이 게임 보드의 플레이 날짜를 유도한다(발행하면, ADR-0022). 이 화면이 saveWeek 라우터의
   프로덕션 소비자라, 머지 시점에 테스트만 보증하는 API 가 남지 않는다(ADR-0010).

   상태 전이(더하기·빼기·고치기·정렬·dirty)의 정본은 core/schedule-editor 의 순수 함수다 —
   이 파일은 그리기와 통신만 한다(games-composer/게임 보드와 같은 결). 모달이 아니라 인라인
   스프레드시트형인 이유: "한 주를 통으로 기획"하는 행위라 7일이 한눈에 보이고 바로 고쳐지는
   편이 맞고, 게임 보드의 모달 CSS 에 기대지 않아 그 페이지와 회귀가 격리된다.

   게임 연결은 **보드에 이미 있는 게임 중에서** 고른다(항목의 game_id 는 games.id FK). 치지직
   검색으로 새 게임을 편집기 안에서 바로 추가하는 길(결정 11)은 이 PR 범위 밖이다 — 새 게임은
   /games 에서 추가한 뒤 여기서 잇는다(매주 반복되는 기존 게임은 이 선택만으로 왕복이 없다). */

/* 발행 체크는 "지금 공개 중인가"를 그린다. 메타 행이 없는 주(이관된 과거 아카이브)는 발행
   시각이 없지만 **그 항목들은 이미 보드에 날짜로 떠 있다**(ADR-0022 의 레거시 규칙). 그래서
   published 를 publishedAt !== null 로만 잡으면 안 된다 — 그러면 레거시 주를 열었을 때 체크가
   풀린 채로 뜨고, 관리자가 무심코 저장하는 순간 published_at NULL 인 메타가 생겨 **그 주의
   과거 플레이 날짜가 보드에서 사라진다**(이관이 지킨 "손실 0"이 첫 편집에서 깨진다).
   메타가 없으면 "이미 공개 중"으로 연다 — 그 상태로 저장하면 발행 시각이 찍혀 계속 보인다.
   내리고 싶으면 관리자가 체크를 직접 푼다(그건 명시적 선택이라 괜찮다). */
function weekToDraft(week: WeekView): WeekDraft {
  return {
    note: week.note ?? "",
    published: week.publishedAt !== null || !week.hasMeta,
    entries: week.entries.map((e) => ({
      key: `db-${e.id}`,
      scheduledDate: e.scheduledDate,
      startTime: e.startTime ?? "",
      title: e.title,
      gameId: e.gameId,
    })),
  };
}

/* 저장 실패 문구. 게임 보드의 writeErrorMessage 를 그대로 못 쓰는 건 어휘가 게임 보드 전용
   ("보드에 있는 게임")이라서다 — 원칙(우리가 확인한 것만 말한다)은 그대로 잇되 일정 어휘로 쓴다. */
function saveErrorMessage(e: unknown): string {
  if (isAborted(e))
    return "응답이 너무 오래 걸려서 기다리기를 멈췄어요. 저장됐을 수도 있으니 새로고침해 확인해 주세요.";
  const code = (e as { data?: { code?: string } } | null)?.data?.code ?? null;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN")
    return "로그인이 만료됐거나 권한이 없어요. 다시 로그인해 주세요.";
  /* 낙관적 동시성 거절. **저장되지 않았다고 단정할 수 있다** — 서버가 쓰기 전에 막았다.
     덮어쓰기를 막은 것이므로 "다시 시도"가 아니라 새로고침해서 남의 저장 위에서 다시 편집하라고
     말한다(그냥 재시도하면 같은 revision 이라 또 걸린다). */
  if (code === "CONFLICT")
    return "다른 곳에서 이 주를 먼저 저장했어요. 저장하지 않았어요 — 새로고침해서 다시 편집해 주세요.";
  // saveWeek 의 BAD_REQUEST: 삭제된 게임을 가리켰거나(FK) 날짜가 그 주를 벗어남(Zod).
  if (code === "BAD_REQUEST")
    return "저장할 수 없는 일정이에요 — 지워진 게임을 가리켰거나 날짜가 그 주를 벗어났을 수 있어요.";
  return "저장됐는지 확인하지 못했어요. 새로고침해서 확인해 주세요.";
}

export function ScheduleEditor({
  weekStartDate,
  initialWeek,
  games,
  currentWeek,
}: {
  weekStartDate: string;
  initialWeek: WeekView;
  games: GameOption[];
  currentWeek: string;
}) {
  const [draft, setDraft] = useState<WeekDraft>(() => weekToDraft(initialWeek));
  // 마지막으로 저장된 기준선. dirty 판정과 "이탈 경고"가 이걸 draft 와 견준다.
  const [baseline, setBaseline] = useState<WeekDraft>(() => weekToDraft(initialWeek));
  /* 불러온 시점의 주 revision. 저장에 되돌려 보내 그 사이 누가 저장했는지 서버가 판정한다
     (service.saveWeek). draft 가 아니라 여기 따로 두는 이유: 편집 내용이 아니라 서버가 준
     동시성 토큰이라 core 의 WeekDraft 에 섞으면 dirty 비교에 끼어든다. 저장이 성공하면 서버가
     준 새 값으로 갈아 끼워야 연속 저장이 이어진다(안 갈면 두 번째 저장이 자기 자신과 충돌한다). */
  const [revision, setRevision] = useState(initialWeek.revision);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [saving, startSave] = useTransition();
  // 새 항목 키의 단조 카운터 — core 는 순수라 상태를 못 들어 여기서 센다.
  const seqRef = useRef(0);
  const gamesById = new Map(games.map((g) => [g.id, g]));
  const days = weekDates(toIsoDate(weekStartDate));
  const dirty = isWeekDirty(draft, baseline);

  /* 미저장 이탈 경고. 두 겹이 필요하다 — 한 겹으로는 절반만 덮인다.

     beforeunload 는 **문서를 실제로 떠날 때만** 뜬다(새로고침·탭 닫기·외부 링크). 이 사이트의
     내부 이동은 전부 next/link 의 client 네비라 문서가 안 바뀌어 그 이벤트가 아예 안 난다 —
     주 이동(WeekNav)뿐 아니라 상단 nav 의 "소개"·"게임", 푸터 사이트맵까지 전부 조용히
     초안을 버린다. 그래서 문서 레벨 **캡처** 클릭 가드를 같이 건다: Link 의 핸들러보다 먼저
     받아 confirm 을 띄우고, 거절하면 그 자리에서 막는다(특정 링크만 감싸면 새 링크가 생길 때마다
     빠뜨린다 — 그게 이 결함이 난 이유다).

     **브라우저 뒤로가기는 못 덮는다.** App Router 엔 취소 가능한 네비게이션 훅이 없고, popstate
     를 되돌리려면 history 에 더미 항목을 심어야 하는데 그건 뒤로가기 자체를 망가뜨린다 —
     초안 하나를 지키자고 브라우저 기본 동작을 비트는 대가가 더 크다. 여기선 안 덮는다고 적어 둔다. */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      // 새 탭·다운로드·보조 클릭은 이 문서를 안 떠난다.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      // 외부 origin 은 문서를 떠나므로 beforeunload 가 맡는다(여기서 두 번 묻지 않는다).
      if (url.origin !== location.origin) return;
      // 같은 화면(해시 앵커 등)은 이탈이 아니다. 주 이동은 search 가 달라 여기서 걸린다.
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (!window.confirm("저장하지 않은 변경이 있어요. 이동하면 사라져요. 이동할까요?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function addForDay(date: string) {
    const entry = makeDraftEntry(newEntryKey(seqRef.current++), date);
    setDraft((d) => addEntry(d, entry));
  }
  function remove(key: string) {
    setDraft((d) => removeEntry(d, key));
  }
  function patch(key: string, p: Parameters<typeof updateEntry>[2]) {
    setDraft((d) => updateEntry(d, key, p));
  }

  function onSave() {
    startSave(async () => {
      setError("");
      try {
        const saved = await trpc.schedule.saveWeek.mutate(
          {
            weekStartDate,
            revision,
            note: draft.note,
            published: draft.published,
            entries: draftEntryInputs(draft),
          },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        const next = weekToDraft(saved);
        setDraft(next);
        setBaseline(next);
        setRevision(saved.revision);
        setAnnouncement(draft.published ? "일정을 저장하고 발행했어요" : "일정을 저장했어요(초안)");
      } catch (e) {
        setError(saveErrorMessage(e));
      }
    });
  }

  return (
    <section className="sched sched--edit" data-od-id="schedule-editor">
      <div className="wrap">
        <header className="sched__head">
          <div className="sched__heading">
            <h1 className="sched__title" data-od-id="schedule-title">
              주간 일정 편집
            </h1>
            <p className="sched__range">
              {formatMD(days[0]!)} – {formatMD(days[6]!)}
            </p>
          </div>
          {/* 주 이동도 내부 링크라 위 문서 레벨 캡처 가드가 함께 덮는다 — 여기만 따로 감싸면
              같은 확인을 두 번 묻게 된다. */}
          <WeekNav weekStart={weekStartDate} currentWeek={currentWeek} />
        </header>

        <label className="sched-note" htmlFor="sched-note-input">
          <span className="sched-note__label">이번 주 공지 (선택)</span>
          <input
            id="sched-note-input"
            className="sched-field"
            type="text"
            maxLength={500}
            placeholder="예: 이번 주는 젤다 위주로 달려요"
            value={draft.note}
            data-od-id="schedule-note-input"
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          />
        </label>

        <ol className="sched__days" data-od-id="schedule-days">
          {days.map((date, i) => {
            const dayEntries = entriesForDate(draft, date);
            return (
              <li key={date} className="sched-day" data-od-id={`schedule-day-${date}`}>
                <div className="sched-day__label">
                  <span className="sched-day__dow">{WEEKDAY_LABELS[i]!}</span>
                  <span className="sched-day__md">{formatMD(date)}</span>
                </div>
                <div className="sched-day__entries">
                  {dayEntries.map((e) => (
                    <div className="sched-row" key={e.key} data-od-id={`schedule-entry-${e.key}`}>
                      <label className="sr-only" htmlFor={`${e.key}-game`}>
                        게임 연결
                      </label>
                      <select
                        id={`${e.key}-game`}
                        className="sched-field sched-row__game"
                        value={e.gameId ?? ""}
                        data-od-id={`schedule-entry-game-${e.key}`}
                        onChange={(ev) => {
                          const val = ev.target.value;
                          if (val === "") {
                            patch(e.key, { gameId: null });
                            return;
                          }
                          const gid = Number(val);
                          // 게임을 고르면 잇고, 제목이 비어 있을 때만 게임명으로 채운다(입력한 제목은 안 덮는다).
                          patch(e.key, {
                            gameId: gid,
                            title:
                              e.title.trim() === ""
                                ? (gamesById.get(gid)?.categoryValue ?? "")
                                : e.title,
                          });
                        }}
                      >
                        <option value="">게임 없음</option>
                        {games.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.categoryValue}
                          </option>
                        ))}
                      </select>

                      <label className="sr-only" htmlFor={`${e.key}-title`}>
                        제목
                      </label>
                      <input
                        id={`${e.key}-title`}
                        className="sched-field sched-row__title"
                        type="text"
                        maxLength={200}
                        placeholder="제목 (예: 저챗)"
                        value={e.title}
                        data-od-id={`schedule-entry-title-${e.key}`}
                        onChange={(ev) => patch(e.key, { title: ev.target.value })}
                      />

                      <label className="sr-only" htmlFor={`${e.key}-time`}>
                        시각 (선택)
                      </label>
                      <input
                        id={`${e.key}-time`}
                        className="sched-field sched-row__time"
                        type="time"
                        value={e.startTime}
                        data-od-id={`schedule-entry-time-${e.key}`}
                        onChange={(ev) => patch(e.key, { startTime: ev.target.value })}
                      />

                      <button
                        type="button"
                        className="sched-row__del"
                        data-od-id={`schedule-entry-del-${e.key}`}
                        onClick={() => remove(e.key)}
                      >
                        <svg aria-hidden="true" viewBox="0 0 16 16">
                          <path
                            d="M4 4l8 8M12 4l-8 8"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                        <span className="sr-only">항목 삭제</span>
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="sched-day__add"
                    data-od-id={`schedule-day-add-${date}`}
                    onClick={() => addForDay(date)}
                  >
                    <span aria-hidden="true">+</span> 항목 추가
                    <span className="sr-only"> ({WEEKDAY_LABELS[i]!})</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="sched-bar" data-od-id="schedule-save-bar">
          <label className="sched-publish" htmlFor="sched-publish">
            <input
              id="sched-publish"
              type="checkbox"
              checked={draft.published}
              data-od-id="schedule-publish"
              onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
            />
            <span className="sched-publish__label">
              발행{" "}
              <span className="sched-publish__hint">
                — 체크하면 공개되고, 보드에 플레이 날짜가 떠요
              </span>
            </span>
          </label>

          {error && (
            <p className="sched-err" role="alert">
              {error}
            </p>
          )}

          <button
            className="btn btn--primary sched-bar__save"
            type="button"
            disabled={saving || !dirty}
            data-od-id="schedule-save"
            onClick={onSave}
          >
            {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
          </button>
        </div>

        <p className="sr-only" role="status">
          {announcement}
        </p>
      </div>
    </section>
  );
}
