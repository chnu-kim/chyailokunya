"use client";

import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { toIsoDate, WEEKDAY_LABELS, weekDates } from "@/core/calendar";
import {
  FanartUploadFailed,
  fanartUploadErrorMessage,
  fanartUploadErrorText,
  isAborted,
} from "@/core/error-message";
import { FANART_IMAGE_TYPES } from "@/core/fanart";
import {
  dayOf,
  draftDayInputs,
  draftHasContent,
  entriesForDate,
  isWeekDirty,
  type DraftEntry,
  type WeekDraft,
} from "@/core/schedule-editor";
import { scheduleSaveMachine, type FanartUploadResult } from "@/core/schedule-save.machine";
import type { GameOption } from "@/features/games/service";
import { buildWeekCard } from "@/features/schedule/card";
import type { WeekView } from "@/features/schedule/service";
import { trpc } from "@/features/trpc/client";
import { PublishConfirmDialog } from "./publish-confirm-dialog";
import { ScheduleGameSearch } from "./schedule-game-search";
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

   게임 연결은 돋보기 버튼 → `schedule-game-search.tsx` 인라인 패널이 맡는다(결정 11·19,
   2026-07-28 구현) — 보드에 이미 있는 게임을 먼저 로컬로 검색하고, 없으면 치지직 검색으로
   새로 추가한다. 항목의 game_id 는 여전히 games.id FK. */

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
      title: e.title,
      gameId: e.gameId,
    })),
    /* 서버는 기본값이 아닌 날만 준다 — 나머지는 키가 없는 채로 두면 dayOf 가 기본값을 준다
       (core 의 EMPTY_DAY). 여기서 7일을 다 채우면 dirty 비교가 "{}"와 달라져 아무것도 안 바꾼
       주가 저장 가능해 보인다. */
    days: Object.fromEntries(
      week.days.map((d) => [d.scheduledDate, { startTime: d.startTime ?? "", rest: d.rest }]),
    ),
    /* 팬아트(ADR-0028). 키는 null 그대로 옮기고 표기만 '' 로 접는다 — WeekDraft 가 두 타입을
       갈라 두는 이유는 그 파일 주석에 있다(표기는 입력 칸, 키·치수는 업로드가 준 값). */
    fanartImageKey: week.fanartImageKey,
    fanartCredit: week.fanartCredit ?? "",
    fanartImageWidth: week.fanartImageWidth,
    fanartImageHeight: week.fanartImageHeight,
  };
}

/* 파일 선택 대화상자가 받아들일 형식. **core/fanart 의 배열에서 유도한다** — 손으로 적으면
   서버가 받는 형식과 갈려, 대화상자가 고를 수 있게 해 준 파일이 업로드에서 415 로 거절된다.
   이건 편의일 뿐 방어선이 아니다(사용자는 "모든 파일"로 바꿔 고를 수 있고, 진짜 판정은
   서버의 매직 바이트다). */
const FANART_ACCEPT = FANART_IMAGE_TYPES.map((t) => `image/${t}`).join(",");

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
      // publishWeek 은 entries·note 를 안 건드리므로 반환도 published·revision 뿐이다
      // (schedule-save.machine.ts 의 PublishWeekResult).
      publishRun: async (values, signal) => {
        const saved = await trpc.schedule.publishWeek.mutate(values, { signal });
        return { published: saved.publishedAt !== null, revision: saved.revision };
      },
      /* 팬아트 업로드(ADR-0028). tRPC 가 아니라 Route Handler 라 여기만 `fetch` 다 — 파일
         바이트를 JSON 경계로 넘기면 base64 로 부풀고 그 비용이 Worker CPU 예산에 얹힌다.
         본문은 raw 바이트다(multipart 가 아니다 — 파일 하나뿐이라 폼이 표현할 게 없다). */
      uploadRun: async ({ file }, signal) => {
        const res = await fetch("/api/fanart", { method: "POST", body: file, signal });
        if (!res.ok) throw new FanartUploadFailed(res.status, await fanartUploadErrorText(res));
        /* **치수도 서버가 준다** — 픽셀 가드가 헤더에서 이미 읽었으므로 공짜다(라우트 주석).
           한때 여기서 `createImageBitmap` 으로 다시 읽었는데, 그건 예산 안(40MP)인 그림도
           160MB 비트맵으로 **관리자 탭에서 디코드**하는 일이라 그 가드가 막으려던 것과 같은
           급의 할당이었다(적대적 리뷰 5라운드). 서버 값을 쓰면 그 비용이 0 이고, 못 읽는
           브라우저에서 치수가 사라지던 저하 경로도 함께 없어진다. */
        return (await res.json()) as FanartUploadResult;
      },
      mapError: saveErrorMessage,
      mapUploadError: fanartUploadErrorMessage,
    },
  });
  const { draft, baseline, revision, error, publishError, fanartError, announcement } =
    state.context;
  const saving = state.matches("saving");
  const publishing = state.matches("publishing");
  const uploading = state.matches("uploading");
  /* 팬아트 조작은 **`ready` 에서만** 받는다(머신) — 그래서 화면도 저장 중까지 함께 잠근다.
     `uploading` 만 보면 저장 중에 파일을 고르거나 내리기를 눌러도 이벤트가 조용히 드롭되고
     아무 문구도 안 뜬다(그때 input 은 value 까지 비워져, 같은 파일을 다시 골라도 change 가
     안 난다) — 저장 버튼에 uploading 을 더한 것과 같은 근거를 반대 방향으로 적용한 자리다.
     발행 중(`publishing`)은 확인창이 `showModal()` 이라 배경이 inert 여서 이미 닫혀 있다. */
  const fanartLocked = uploading || saving;
  /* games prop 을 로컬 상태로 승격한다 — 편집기 안에서 새 게임을 추가하면(ScheduleGameSearch)
     서버가 다시 내려주기 전까지는 이 목록에만 존재한다. 주가 바뀌면 이 컴포넌트가 key 로
     리마운트되므로(page.tsx) 초기값만으로 충분하다. */
  const [localGames, setLocalGames] = useState<GameOption[]>(games);
  const gamesById = new Map(localGames.map((g) => [g.id, g]));
  const days = weekDates(toIsoDate(weekStartDate));
  const dirty = isWeekDirty(draft, baseline);
  // 지금 게임 검색 패널이 열린 항목의 key. 한 번에 하나만 연다(아코디언) — 여러 패널이 동시에
  // 열리면 각자 자기 검색어를 따로 들고 있어야 해서 화면이 붐빈다.
  const [openGameSearchKey, setOpenGameSearchKey] = useState<string | null>(null);
  /* 발행·비공개 전환 확인창. null = 닫힘. 버튼은 이걸로 여는 신호만 세우고, 실제 뮤테이션은
     확인을 누른 뒤(PublishConfirmDialog 의 onConfirm)에만 나간다. */
  const [confirmMode, setConfirmMode] = useState<"publish" | "unpublish" | null>(null);
  /* 발행은 항상 baseline(이미 저장된 값)을 대상으로 한다 — WeekCardDownload 가 baseline 으로
     카드를 만드는 것과 같은 원칙(결정 22). revision===null 은 저장된 적 없는 주(레거시 아카이브
     포함)라 발행 자체가 성립하지 않는다 — 머신의 canPublish 가드와 같은 조건을 화면도 들고
     있어야 disabled 문구를 정확히 띄운다.

     canUnpublish 는 **dirty 를 안 본다** — 공개를 거두는 건 저장된 값을 새로 공개하는 게
     아니라서 그 원칙이 적용될 대상이 없다(머신의 canUnpublish 와 같은 비대칭, 그 파일 주석
     참고). 급히 공개를 내려야 하는데 마침 다른 걸 고치던 중이라 막히면 안전이 아니라 방해다. */
  /* "빈 주"는 항목 0 **그리고** 휴방 0 이다(이슈 #117 결정 9) — 7일을 전부 휴방으로 정한 주는
     항목이 없어도 관리자가 짠 결과라 발행할 만하다. 서버의 같은 가드(weekHasContent)와 규칙을
     맞춘다: 갈리면 화면은 버튼을 열어 주는데 서버가 거절한다. */
  const canPublish = !dirty && revision !== null && draftHasContent(baseline);
  const canUnpublish = revision !== null;

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
        ? buildWeekCard({
            weekStartDate,
            note: baseline.note,
            entries: baseline.entries,
            days: draftDayInputs(baseline),
          })
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
  function onPickFanart(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    /* **값을 비운다.** 같은 파일을 다시 고르면 input 의 value 가 그대로여서 change 가 아예
       안 나고, 실패 후 "같은 파일로 재시도"가 조용히 안 먹는다(사용자에겐 버튼이 죽은 것으로
       보인다). 비우는 시점은 send 앞이어야 한다 — 뒤에 두면 리렌더가 끼는 순서에 달린다. */
    e.target.value = "";
    if (file) send({ type: "FANART_UPLOAD", file });
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

        {/* 팬아트(ADR-0028) — 주에 딸린 부가 정보라 공지 바로 아래다. **입력 컨트롤이 있으므로
            사진지 섬(.polaroid)을 쓰지 않는다**: 그 섬은 다크에서 라이트 토큰을 국소 재선언한
            크림 종이라 폼 컨트롤의 테두리·포커스 대비가 거기서 씻긴다(kunya-design §4). 읽기
            화면은 조작이 없어 그쪽이 폴라로이드다 — 같은 값을 두 화면이 다른 부품으로 그리는
            게 맞는 자리다.

            미리보기는 **실제 서빙 경로**(/api/fanart/…)로 그린다. objectURL 이 아니라 그걸 쓰면
            "저장하면 팬이 볼 그림" 그대로를 보고, 서빙 라우트까지 이 화면에서 함께 검증된다. */}
        <div
          className="sched-fanart"
          role="group"
          aria-labelledby="sched-fanart-label"
          data-od-id="schedule-fanart"
        >
          <span className="sched-note__label" id="sched-fanart-label">
            팬아트 (선택)
          </span>

          <div className="sched-fanart__row">
            {draft.fanartImageKey && (
              /* 96×96 고정 슬롯 + contain. 편집기에서 알고 싶은 건 "무엇을 올렸나"이지 정확한
                 비율이 아니라, 그림마다 높이가 변해 아래 요일 목록이 밀리는 것보다 안정된
                 자리가 낫다(읽기 화면은 반대로 실제 치수로 예약한다). */
              <img
                className="sched-fanart__thumb"
                src={`/api/fanart/${draft.fanartImageKey}`}
                alt="올린 팬아트"
                width={96}
                height={96}
                data-od-id="schedule-fanart-thumb"
              />
            )}
            <div className="sched-fanart__acts">
              {/* 파일 input 은 스타일이 안 먹어 label 로 감싼다 — 클릭·키보드 포커스는 여전히
                  input 이 받고(sr-only 는 clip 이라 포커스가 살아 있다), 링은 아래 CSS 의
                  :focus-within 이 label 에 그린다. */}
              <label className="btn btn--secondary sched-fanart__pick">
                {draft.fanartImageKey ? "바꾸기" : "그림 올리기"}
                <input
                  type="file"
                  className="sr-only"
                  accept={FANART_ACCEPT}
                  disabled={fanartLocked}
                  data-od-id="schedule-fanart-file"
                  onChange={onPickFanart}
                />
              </label>
              {draft.fanartImageKey && (
                <button
                  type="button"
                  className="btn btn--secondary sched-fanart__del"
                  disabled={fanartLocked}
                  data-od-id="schedule-fanart-remove"
                  onClick={() => send({ type: "FANART_REMOVED" })}
                >
                  내리기
                </button>
              )}
            </div>
          </div>

          {/* 제약을 관리자에게 보여 준다 — 서버 변환을 안 하기로 한 대가라(ADR-0028) 원본이 큰
              그림은 미리 줄여 올려야 한다. 값 칸이라 문장이 아니라 표기다(AGENTS). */}
          <p className="sched-fanart__hint">PNG · JPEG · WebP · 5MB 이하</p>

          {/* 치수를 못 읽었을 때만 뜬다(ADR-0030 의 fail-open) — **업로드는 성공으로 끝나므로
              이 문단이 없으면 관리자에게 아무 신호가 없다.** 개발 중 CRC 깨진 PNG 로 정확히 그
              상태를 만들었고, 화면·게이트 어디에도 흔적이 없어 D1 을 직접 들여다봐야 했다.
              오류가 아니라 안내라 `.sched-err`(danger)를 쓰지 않는다 — 그림은 정상 표시된다.
              안내문은 말을 거는 자리라 문장이고, 합쇼체다(AGENTS). */}
          {draft.fanartImageKey && draft.fanartImageWidth === null && (
            <p className="sched-fanart__hint" data-od-id="schedule-fanart-nosize">
              그림 크기를 읽지 못했습니다. 표시는 되지만 자리를 미리 비우지 못합니다.
            </p>
          )}

          {uploading && (
            <p className="sched-fanart__busy" role="status" data-od-id="schedule-fanart-busy">
              올리는 중…
            </p>
          )}
          {fanartError && (
            <p className="sched-err" role="alert" data-od-id="schedule-fanart-error">
              {fanartError}
            </p>
          )}

          {/* 표기 칸은 **그림이 있을 때만** 연다 — 그림 없이 표기만 있는 조합은 서버 Zod·DB
              CHECK 가 둘 다 거절하므로, 화면이 애초에 못 만들게 하는 게 가장 조용한 방어다.
              업로드 중에는 잠근다: 성공하면 표기가 비워지므로(새 그림에 옛 이름을 안 붙인다)
              그 사이 타이핑한 값이 사라져 보인다. */}
          {draft.fanartImageKey && (
            <label className="sched-note sched-fanart__credit">
              <span className="sched-note__label">작가 표기 (선택)</span>
              <input
                className="sched-field"
                type="text"
                maxLength={100}
                placeholder="그린 사람"
                value={draft.fanartCredit}
                disabled={uploading}
                data-od-id="schedule-fanart-credit"
                onChange={(e) => send({ type: "FANART_CREDIT_CHANGED", credit: e.target.value })}
              />
            </label>
          )}
        </div>

        <ol className="sched__days" data-od-id="schedule-days">
          {days.map((date, i) => {
            const dayEntries = entriesForDate(draft, date);
            const day = dayOf(draft, date);
            return (
              <li key={date} className="sched-day" data-od-id={`schedule-day-${date}`}>
                <div className="sched-day__label">
                  <span className="sched-day__dow">{WEEKDAY_LABELS[i]!}</span>
                  <span className="sched-day__md">{formatMD(date)}</span>
                </div>
                <div className="sched-day__entries">
                  {/* 하루의 속성(이슈 #117) — 시각과 휴방. 항목 행이 아니라 여기 한 번만 선다.
                      휴방이면 시각 입력을 잠근다: 쉬는 날에 시작 시각을 붙이는 건 뜻이 안 맞고,
                      잠가 두면 그 조합을 만들 길 자체가 없어진다(표시에서 휴방이 이긴다는
                      결정 5 를 입력 단계에서 미리 지킨다). */}
                  <div className="sched-day__meta">
                    <label className="sr-only" htmlFor={`${date}-time`}>
                      {formatMD(date)} 방송 시작 시각
                    </label>
                    <input
                      id={`${date}-time`}
                      className="sched-field sched-day__time"
                      type="time"
                      value={day.startTime}
                      disabled={day.rest}
                      data-od-id={`schedule-day-time-${date}`}
                      onChange={(ev) =>
                        send({ type: "DAY_PATCHED", date, patch: { startTime: ev.target.value } })
                      }
                    />
                    <label className="sched-day__rest-toggle">
                      <input
                        type="checkbox"
                        checked={day.rest}
                        data-od-id={`schedule-day-rest-${date}`}
                        onChange={(ev) =>
                          send({ type: "DAY_PATCHED", date, patch: { rest: ev.target.checked } })
                        }
                      />
                      휴방
                    </label>
                  </div>
                  {dayEntries.map((e) => (
                    <div
                      className="sched-entry-block"
                      key={e.key}
                      data-od-id={`schedule-entry-${e.key}`}
                    >
                      <div className="sched-row">
                        <button
                          type="button"
                          className="sched-field sched-row__game-trigger"
                          aria-haspopup="true"
                          aria-expanded={openGameSearchKey === e.key}
                          data-od-id={`schedule-entry-game-trigger-${e.key}`}
                          onClick={() =>
                            setOpenGameSearchKey(openGameSearchKey === e.key ? null : e.key)
                          }
                        >
                          <svg
                            className="sched-row__game-icon"
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                          >
                            <circle
                              cx="7"
                              cy="7"
                              r="5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                            />
                            <path
                              d="M11 11l3.5 3.5"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="sched-row__game-name">
                            {e.gameId !== null
                              ? (gamesById.get(e.gameId)?.categoryValue ?? "연결된 게임")
                              : "게임 연결"}
                          </span>
                        </button>

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

                      {openGameSearchKey === e.key && (
                        <ScheduleGameSearch
                          idPrefix={`schedule-entry-game-search-${e.key}-`}
                          localGames={localGames}
                          currentGameId={e.gameId}
                          onPick={(gameId, categoryValue) =>
                            patch(e.key, {
                              gameId,
                              // 제목이 비어 있을 때만 게임명으로 채운다(입력한 제목은 안 덮는다) —
                              // 옛 select 와 같은 규칙.
                              title: e.title.trim() === "" ? categoryValue : e.title,
                            })
                          }
                          onUnlink={() => patch(e.key, { gameId: null })}
                          onGameCreated={(g) => setLocalGames((prev) => [...prev, g])}
                          onClose={() => setOpenGameSearchKey(null)}
                        />
                      )}
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

        {/* 저장·발행 바 — 뷰포트 하단 sticky(결정 23). 발행은 저장과 분리된 별도 확인 흐름이다
            (결정 14 개정) — 체크박스가 아니라 지금 상태를 말하는 칩 + 반대 상태로 여는 버튼. */}
        <div className="sched-bar" data-od-id="schedule-save-bar">
          <div className="sched-status" data-od-id="schedule-publish-status">
            <span
              className={baseline.published ? "chip chip--ok" : "chip chip--ink"}
              data-od-id="schedule-publish-chip"
            >
              {baseline.published ? "공개 중" : "비공개"}
            </span>
            <button
              type="button"
              className="btn btn--secondary sched-status__btn"
              data-od-id="schedule-publish-toggle"
              disabled={baseline.published ? !canUnpublish : !canPublish}
              onClick={() => setConfirmMode(baseline.published ? "unpublish" : "publish")}
            >
              {baseline.published ? "비공개로 전환" : "발행하기"}
            </button>
            {/* 발행(공개 전환)만 dirty 에 막힌다 — 비공개 전환은 안 막힌다(canUnpublish 주석).
                세 갈래가 서로 안 겹친다(dirty·entries 없음·저장된 적 없음) — 한 번에 하나만 뜬다. */}
            {!baseline.published && dirty && (
              <p className="sched-status__hint">
                저장하지 않은 변경이 있어 발행할 수 없습니다. 먼저 저장해 주십시오.
              </p>
            )}
            {!baseline.published && !dirty && !draftHasContent(baseline) && (
              <p className="sched-status__hint">항목이나 휴방이 있어야 발행할 수 있습니다.</p>
            )}
            {/* 이관된 레거시 주(항목은 있지만 schedule_weeks 메타가 없어 revision 이 null)가
               이 경로다 — dirty 도 아니고 entries 도 있지만 저장된 적이 없어 발행 대상이 될
               revision 자체가 없다(canPublish 가드와 같은 조건, 그 주석 참고). 무언가 고쳐 한 번
               저장해야 다음부터 발행할 수 있다. */}
            {!baseline.published && !dirty && draftHasContent(baseline) && revision === null && (
              <p className="sched-status__hint">
                이 주는 아직 저장된 적이 없습니다. 무언가 고친 뒤 저장하면 발행할 수 있습니다.
              </p>
            )}
          </div>

          {error && (
            <p className="sched-err" role="alert" data-od-id="schedule-save-error">
              {error}
            </p>
          )}

          {/* 업로드 중에도 잠근다 — 머신이 그 이벤트를 무시하지만(uploading 상태에 on 이 없다)
              눌리는 것처럼 보이면 관리자는 저장이 된 줄 안다. 방어선은 머신이고 이건 표시다. */}
          <button
            className="btn btn--primary sched-bar__save"
            type="button"
            disabled={saving || uploading || !dirty}
            data-od-id="schedule-save"
            onClick={onSave}
          >
            {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
          </button>
        </div>

        {confirmMode && (
          <PublishConfirmDialog
            odId="schedule-publish-confirm"
            mode={confirmMode}
            publishing={publishing}
            error={publishError}
            onConfirm={() => send({ type: confirmMode === "publish" ? "PUBLISH" : "UNPUBLISH" })}
            onClose={() => setConfirmMode(null)}
          />
        )}

        <p className="sr-only" role="status">
          {announcement}
        </p>
      </div>
    </section>
  );
}
