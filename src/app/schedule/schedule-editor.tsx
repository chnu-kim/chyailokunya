"use client";

import { useMachine } from "@xstate/react";
import { useEffect, useMemo } from "react";
import { toIsoDate, WEEKDAY_LABELS, weekDates } from "@/core/calendar";
import { isAborted } from "@/core/error-message";
import {
  entriesForDate,
  isWeekDirty,
  type DraftEntry,
  type WeekDraft,
} from "@/core/schedule-editor";
import { scheduleSaveMachine } from "@/core/schedule-save.machine";
import type { GameOption } from "@/features/games/service";
import { buildWeekCard } from "@/features/schedule/card";
import type { WeekView } from "@/features/schedule/service";
import { trpc } from "@/features/trpc/client";
import { formatMD, WeekNav } from "./schedule-shared";
import { WeekCardDownload } from "./week-card-download";

/* 주간 일괄 편집기(이슈 #56 작업순서 6, 결정 12·14). PR #59 가 games.played_at 을 드롭하며 없앤
   "라이브에서 게임 플레이 날짜 배정"을 되살리는 화면이다 — 관리자가 한 주를 통째로 짜서 저장하면
   그 항목이 게임 보드의 플레이 날짜를 유도한다(발행하면, ADR-0022). 이 화면이 saveWeek 라우터의
   프로덕션 소비자라, 머지 시점에 테스트만 보증하는 API 가 남지 않는다(ADR-0010).

   상태 전이(더하기·빼기·고치기·정렬·dirty)의 정본은 core/schedule-editor 의 순수 함수다.
   draft·baseline·revision·error·announcement·저장 중 여부는 그 함수들을 자식 submit 액터와
   함께 감싼 core/schedule-save.machine(에픽 #77 이슈 #85)이 쥔다 — 이 파일은 그리기와 이벤트
   전달만 한다(games-composer/게임 보드와 같은 결). 모달이 아니라 인라인 스프레드시트형인 이유:
   "한 주를 통으로 기획"하는 행위라 7일이 한눈에 보이고 바로 고쳐지는 편이 맞고, 게임 보드의
   모달 CSS 에 기대지 않아 그 페이지와 회귀가 격리된다.

   게임 연결은 **보드에 이미 있는 게임 중에서** 고른다(항목의 game_id 는 games.id FK). 치지직
   검색으로 새 게임을 편집기 안에서 바로 추가하는 길(결정 11)은 이 PR 범위 밖이다 — 새 게임은
   /games 에서 추가한 뒤 여기서 잇는다(매주 반복되는 기존 게임은 이 선택만으로 왕복이 없다). */

/* 발행 체크 기본값 = **그 주가 지금 공개돼 있나**, 그게 전부다.

   한때 여기에 "메타가 없고 항목이 있으면 켠다"는 갈래가 있었다. 이관된 레거시 주를 발행 끈 채
   저장하면 published_at NULL 인 메타가 생겨 그 주의 과거 플레이 날짜가 보드에서 사라졌기
   때문에(손실 0 이 첫 편집에서 깨진다), 체크를 미리 켜 두는 걸로 우회했다 — 화면이 서버의
   구현 사정(메타 행이 있나)을 알아야 성립하는 파생이었다.

   draft 축이 생기면서 그 사정이 사라졌다(ADR-0022 갱신): 발행과 보드 표시가 독립이라 발행을
   안 켜고 저장해도 과거 날짜가 산다. 그래서 이 화면은 공개 여부 하나만 그리면 되고, 초안이냐
   확정이냐는 서버가 정한다(saveWeek). */
function weekToDraft(week: WeekView): WeekDraft {
  return {
    note: week.note ?? "",
    published: week.publishedAt !== null,
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
    return "응답이 너무 오래 걸려서 기다리기를 멈췄습니다. 저장됐을 수도 있으니 새로고침해 확인해 주십시오.";
  const code = (e as { data?: { code?: string } } | null)?.data?.code ?? null;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN")
    return "로그인이 만료됐거나 권한이 없습니다. 다시 로그인해 주십시오.";
  /* 낙관적 동시성 거절. **저장되지 않았다고 단정할 수 있다** — 서버가 쓰기 전에 막았다.
     덮어쓰기를 막은 것이므로 "다시 시도"가 아니라 새로고침해서 남의 저장 위에서 다시 편집하라고
     말한다(그냥 재시도하면 같은 revision 이라 또 걸린다). */
  if (code === "CONFLICT")
    return "다른 곳에서 이 주를 먼저 저장했습니다. 저장하지 않았습니다 — 새로고침해서 다시 편집해 주십시오.";
  // saveWeek 의 BAD_REQUEST: 삭제된 게임을 가리켰거나(FK) 날짜가 그 주를 벗어남(Zod).
  if (code === "BAD_REQUEST")
    return "저장할 수 없는 일정입니다 — 지워진 게임을 가리켰거나 날짜가 그 주를 벗어났을 수 있습니다.";
  return "저장됐는지 확인하지 못했습니다. 새로고침해서 확인해 주십시오.";
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
  /* schedule-save 머신이 draft·baseline·revision·error·announcement·저장 중 여부를 전부 쥔다
     (core/schedule-save.machine.ts). run·mapError·initialDraft·initialRevision 은 마운트
     시점에 얼어붙는다(submit 머신의 계약과 같다) — 이 컴포넌트는 주가 바뀔 때마다 `key` 로
     리마운트되므로(page.tsx) 그걸로 충분하다. */
  const [state, send] = useMachine(scheduleSaveMachine, {
    input: {
      weekStartDate,
      initialDraft: weekToDraft(initialWeek),
      initialRevision: initialWeek.revision,
      run: async (values, signal) => {
        const saved = await trpc.schedule.saveWeek.mutate(values, { signal });
        return { draft: weekToDraft(saved), revision: saved.revision };
      },
      mapError: saveErrorMessage,
    },
  });
  const { draft, baseline, error, announcement } = state.context;
  const saving = state.matches("saving");
  const gamesById = new Map(games.map((g) => [g.id, g]));
  const days = weekDates(toIsoDate(weekStartDate));
  const dirty = isWeekDirty(draft, baseline);

  /* 다운로드 카드는 **저장된 상태**(baseline)에서만 만든다 — draft(화면에 입력 중인, 아직
     안 저장한 값)로 만들면 결정 2("미완성본이 박제되면 안 된다")가 저장 전 편집 중에도 뚫린다.
     baseline.published 는 이 주가 지금 실제로 공개돼 있는지를 그대로 반영한다(weekToDraft 가
     publishedAt !== null 로 세팅) — 발행 체크박스를 켰지만 아직 저장을 안 눌렀다면 여전히
     null(비활성)이다. 저장에 성공하면 baseline 이 서버 응답으로 갈아 끼워지므로(schedule-save
     머신) 새로고침 없이 바로 활성화된다.

     useMemo 로 baseline 이 실제로 바뀔 때만 새 오브젝트를 만든다 — note 입력·항목 추가 등
     draft 가 바뀔 때마다 이 컴포넌트가 다시 그려지는데, 그때마다 buildWeekCard 를 새로 불러
     날짜 배열까지 매번 다시 만들 이유가 없다(순수 최적화). week-card-download.tsx 의 in-flight
     캐시는 이 오브젝트의 참조가 아니라 내용(JSON)으로 가르므로(라운드 6 적대적 리뷰) 이
     useMemo 가 없어도 캐시 판정 자체는 그르치지 않는다 — 다만 없으면 타이핑 한 글자마다
     buildWeekCard 를 다시 부르는 낭비가 남는다. */
  const card = useMemo(
    () =>
      baseline.published
        ? buildWeekCard({ weekStartDate, note: baseline.note, entries: baseline.entries })
        : null,
    [weekStartDate, baseline],
  );

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
      if (
        !window.confirm("저장하지 않은 변경이 있습니다. 이동하면 사라집니다. 이동하시겠습니까?")
      ) {
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
    send({ type: "ENTRY_ADDED", date });
  }
  function remove(key: string) {
    send({ type: "ENTRY_REMOVED", key });
  }
  function patch(key: string, p: Partial<Omit<DraftEntry, "key">>) {
    send({ type: "ENTRY_PATCHED", key, patch: p });
  }
  function onSave() {
    send({ type: "SAVE" });
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
            placeholder="예: 이번 주는 젤다 위주로 달립니다"
            value={draft.note}
            data-od-id="schedule-note-input"
            onChange={(e) => send({ type: "NOTE_CHANGED", note: e.target.value })}
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

        <WeekCardDownload card={card} weekStartDate={weekStartDate} stale={dirty} />

        <div className="sched-bar" data-od-id="schedule-save-bar">
          <label className="sched-publish" htmlFor="sched-publish">
            <input
              id="sched-publish"
              type="checkbox"
              checked={draft.published}
              data-od-id="schedule-publish"
              onChange={(e) => send({ type: "PUBLISHED_CHANGED", published: e.target.checked })}
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
