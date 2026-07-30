import { assign, sendTo, setup } from "xstate";
import { formatMD, toIsoDate, WEEKDAY_LABELS, weekDates, weekStartOf } from "./calendar";
import {
  addEntry,
  draftDayInputs,
  draftEntryInputs,
  draftHasContent,
  firstBlankTitleEntry,
  isWeekDirty,
  makeDraftEntry,
  newEntryKey,
  removeEntry,
  setDay,
  updateEntry,
  type DraftDayInput,
  type DraftEntry,
  type DraftEntryInput,
  type WeekDraft,
} from "./schedule-editor";
import { createSubmitMachine, type SubmitInput } from "./submit.machine";

/* 저장을 막은 빈 제목 항목이 어느 요일인지 짚어 안내한다(firstBlankTitleEntry 주석) — "제목이
   없다"만 말하면 항목이 여러 날에 흩어진 편집기에서 어느 줄인지 못 찾는다. */
function blankTitleMessage(entry: DraftEntry): string {
  const days = weekDates(weekStartOf(toIsoDate(entry.scheduledDate)));
  const i = days.indexOf(toIsoDate(entry.scheduledDate));
  return `${WEEKDAY_LABELS[i]!}요일(${formatMD(entry.scheduledDate)}) 항목에 제목이 없습니다. 제목을 채우거나 삭제해 주십시오.`;
}

/* 주간 편집기 저장 머신(에픽 #77 이슈 #85) — `schedule-editor.tsx` 가 들고 있던
   `draft`·`baseline`·`revision`·`error`·`announcement`·`saving`(useTransition)·`seqRef` 를
   대체한다. **유일하게 낙관적 동시성(CAS)이 걸린 머신이고, `submit` 머신을 자식으로 감싼다**
   (schedule-editor 는 submit 이 필요한 6번째 자리인데, 앞 단계(#80)에서 따로 배선하면
   schedule-editor.tsx 를 두 번 만지므로 여기서 한 번에 한다).

   ── submit 을 어떻게 자식으로 감쌌나 ────────────────────────────────────────────────
   submit.machine 은 idle/submitting/done 세 상태를 오가며 **top-level final 이 없다**(done 도
   재사용을 위해 다시 submit 을 받는다) — 그래서 XState 의 `invoke.onDone`(액터가 종료할 때만
   발화)으로는 이 자식의 성공·실패를 못 듣는다. 대신 `invoke.onSnapshot`(자식이 스냅샷을 낼 때마다
   발화, 액터 종료를 요구하지 않는다)으로 매 전이를 관찰해 "done" 이면 저장 성공, "idle"인데
   error 가 있으면 실패로 판정한다. submit.machine.ts 자체는 한 글자도 안 고친다 — 이미 5곳이
   그 파일을 직접 쓰고 있어(games-composer 등) parent 참조를 넣으면 그 5곳까지 흔드는 결합이
   생긴다. invoke 를 **루트**에 둔 이유: submit 자식은 화면이 사는 동안 죽지 않아야 하는데(여러
   번 저장), 특정 리프 상태 안에 두면 그 상태를 벗어날 때 XState 가 액터를 멈춘다. 루트에 두면
   board-overlay 머신의 루트 `on`(어느 리프에 있든 받는 이벤트)과 같은 자리에서, "어느 리프에
   있든 살아있는 액터"가 된다 — `ready`/`saving` 은 그 자식에게 이벤트를 보내고 결과를 받는
   **판정**일 뿐, 자식의 생명주기와는 무관하다.

   ── 왜 편집 이벤트가 루트 `on` 인가 ──────────────────────────────────────────────────
   원본은 저장 중에도 입력을 잠그지 않는다(버튼만 `disabled`) — 그래서 NOTE_CHANGED 류는 `ready`·
   `saving` 어느 쪽에 있든 받아야 한다. `SAVE` 만 `ready` 안에 둬 저장 중 재제출을 막는다(submit
   머신 자신의 "그 잠금이 유일한 방어선이 되면 안 된다" 원칙과 같다 — 버튼 disabled 가 유일한
   방어선이 아니다).

   ── 저장 중 편집이 끼면 서버 응답이 이긴다 ────────────────────────────────────────────
   저장이 성공하면 draft·baseline 을 **서버가 되돌려준 값으로 통째로 교체**한다(원본 onSave 의
   `setDraft(next); setBaseline(next)` 와 동일) — 저장이 날아간 사이 사용자가 입력을 더 고쳤어도
   그 편집은 서버 응답에 덮인다. 편집을 잠그지 않기로 한 선택의 대가이고, 원본부터 있던 동작이라
   이 리팩토링이 새로 들이는 게 아니다.

   ── revision 은 다음 저장에 그대로 실린다 ────────────────────────────────────────────
   성공 액션이 `revision` 을 서버가 준 새 값으로 갈아 끼운다 — 안 갈면 두 번째 저장이 옛 revision
   을 들고 나가 자기 자신과 충돌한다(D1 CAS, [[d1-no-interactive-transactions-concurrency-boundary]]
   와 같은 결의 CAS).

   ── 발행·비공개 전환은 두 번째 submit 자식(publish)이다(이슈 #56 결정 14 개정, 2026-07-28) ──
   저장(SAVE)과 발행(PUBLISH·UNPUBLISH)이 체크박스+저장 버튼 한 묶음이라 헷갈린다는 피드백으로
   갈랐다 — `publishWeek` 뮤테이션은 entries·note 를 안 건드리고 `published_at` 만 바꾼다. `submit`
   과 같은 이유로 루트에 두 번째 invoke 를 얹는다(화면이 사는 동안 안 죽어야 여러 번 발행·철회를
   반복할 수 있다). 에러 필드를 **나눈다**(`error` vs `publishError`) — 하나를 공유하면 "저장이
   실패해서 남은 옛 문구"를 발행 확인창이 "방금 발행이 실패했다"로 오독할 창이 생긴다(둘 다 같은
   `ready` 상태로 돌아오므로 시점만으론 못 가른다).

   ── 팬아트 업로드는 세 번째 submit 자식이다(ADR-0028, 이슈 #120 PR 2) ────────────────
   파일 바이트가 `POST /api/fanart` 로 나가 `{ key }` 를 받는 비동기 왕복이고, 진행·실패·성공이
   갈리며 성공값이 **draft 에 반영돼야** 한다 — 위 두 자식과 정확히 같은 모양이라 새 머신을
   만들지 않고 자식을 하나 더 얹는다(AGENTS 의 8종 머신 표에서 "수명·공유 범위가 비슷한 자리를
   찾아 따라간다"). 루트에 두는 이유도 같다: 관리자가 한 화면에서 그림을 여러 번 바꿀 수 있다.

   **업로드 중에는 `SAVE` 를 받지 않는다**(`uploading` 상태에 `on` 이 없다). 저장이 먼저 나가면
   아직 키가 없는 draft 가 저장돼 "올렸는데 안 걸렸다"가 되고, 관리자는 업로드가 실패한 것으로
   읽는다. 편집 이벤트는 기존대로 루트 `on` 이라 업로드 중에도 공지·항목을 계속 고칠 수 있다.

   에러도 셋으로 나눈다(`error`/`publishError`/`fanartError`) — 하나를 공유하면 "저장이 실패해서
   남은 문구"를 업로드 자리가 자기 실패로 보여준다(그 둘은 화면의 다른 자리에 뜬다).

   `PUBLISH`·`UNPUBLISH` 는 **`ready` 에서만** 받는다(SAVE 와 같은 자리) — 이 판정은 UI 버튼
   disabled 의 보험이지 유일한 방어선은 아니다(disabled 가 유일한 방어선이면 안 된다는 원칙은
   submit.machine.ts 의 "저장 중 재제출 무시"와 같다). 두 가드는 **비대칭**이다(Plan 에이전트
   리뷰, 2026-07-28):
   - `PUBLISH` — revision 이 없거나(저장된 적 없는 주) dirty 하거나(발행은 항상 baseline, 즉
     이미 저장된 값을 대상으로 한다 — WeekCardDownload 가 baseline 으로 카드를 만드는 것과 같은
     원칙) entries 가 비어 있으면(빈 주를 공개할 이유가 없다) 막는다.
   - `UNPUBLISH` — revision 이 없을 때만 막는다. dirty 여부는 안 본다: 공개를 거두는 건 "이미
     저장된 값을 새로 공개"하는 게 아니라 이미 공개된 걸 내리는 것뿐이라 그 원칙이 적용될
     대상이 없고, 오히려 급히 내려야 하는데 마침 다른 걸 고치던 중이라 막히면 안전이 아니라
     방해가 된다. */

/* saveWeek 뮤테이션 입력의 shape 만 미러링한다(core 는 features/schema.ts 의 Zod 타입을 못
   본다 — schedule-editor.ts 의 "core 경계 때문에 shape 만 맞춘다" 와 같은 이유). */
export type SaveWeekValues = {
  weekStartDate: string;
  revision: number | null;
  note: string;
  published: boolean;
  entries: DraftEntryInput[];
  /* 하루의 속성(이슈 #117). 기본값인 날은 draftDayInputs 가 이미 접어 낸다 — 서버도 같은
     필터를 다시 걸지만, 여기서 접어야 dirty 판정과 저장 페이로드가 같은 정규형을 본다. */
  days: DraftDayInput[];
  /* 팬아트 둘(ADR-0028). **편집기는 둘을 항상 보낸다** — 서버의 `undefined = 유지` 규약은 이
     필드를 모르는 옛 클라이언트(배포 중 열려 있던 탭)를 위한 것이고, 화면이 그 규약에 기대면
     "지움"을 표현할 수 없다. **치수는 안 보낸다**: 업로드가 R2 객체 메타에 묶고 저장 경로가
     거기서 읽는다(ADR-0030) — 화면이 에코하면 그 값이 다시 클라이언트 주장이 된다. */
  fanartImageKey: string | null;
  fanartCredit: string | null;
};

/* 업로드 자식이 실어 보낼 값과 받아 올 결과. `Blob` 은 workerd·브라우저 공통 전역이라
   core/fanart.ts 의 `Uint8Array` 와 같은 급의 런타임 중립 타입이다 — 이 파일은 여전히 HTTP 를
   모르고, 실제 POST 는 호출자가 준 `uploadRun` 안에 있다.

   **결과는 키 하나다.** 치수는 업로드가 R2 객체 메타에 묶고 저장 경로가 거기서 읽으므로
   (ADR-0030) 화면을 거칠 필요가 없다 — 거치면 그 값이 다시 클라이언트 주장이 된다. */
export type FanartUploadValues = { file: Blob };
export type FanartUploadResult = { key: string };

/* run 의 반환 shape. 실제 tRPC 응답(WeekView, features 타입)을 core 가 못 보므로, 호출자가
   `weekToDraft` 로 변환한 뒤 이 shape 로 넘긴다 — 머신은 WeekView 를 몰라도 된다. */
export type SaveWeekResult = {
  draft: WeekDraft;
  revision: number | null;
};

// 제네릭 인자를 고정해 한 번만 만든다 — schedule-editor 는 하나뿐이라 board-overlay 처럼 화면마다
// 인스턴스화할 이유가 없다(WeekDraft 가 이미 core 소유 타입이라 games 쪽과 달리 제네릭도 필요 없다).
const saveSubmitMachine = createSubmitMachine<SaveWeekValues, SaveWeekResult>();

/* publishWeek 뮤테이션 입력의 shape 미러링. entries·note 가 없다 — 그 뮤테이션 자체가 그 둘을
   안 건드린다(schema.ts 의 publishWeekInput 주석). revision 은 saveWeekInput 과 달리 null 을
   안 받는다 — 가드가 이미 저장된 적 있는 주에서만 PUBLISH·UNPUBLISH 를 허용한다. */
export type PublishWeekValues = {
  weekStartDate: string;
  revision: number;
  published: boolean;
};

// run 의 반환 shape. draft 전체가 아니라 published 하나뿐이다 — 그 값만 바뀌므로.
export type PublishWeekResult = {
  published: boolean;
  revision: number | null;
};

const publishSubmitMachine = createSubmitMachine<PublishWeekValues, PublishWeekResult>();

const uploadSubmitMachine = createSubmitMachine<FanartUploadValues, FanartUploadResult>();

export type ScheduleSaveInput = SubmitInput<SaveWeekValues, SaveWeekResult> & {
  weekStartDate: string;
  initialDraft: WeekDraft;
  initialRevision: number | null;
  // publish 자식 전용 run — mapError 는 submit 과 함께 쓴다(위 SubmitInput 이 이미 담고 있다).
  publishRun: SubmitInput<PublishWeekValues, PublishWeekResult>["run"];
  // 업로드 자식 전용 run. **mapError 는 공유하지 않는다** — 저장 매퍼는 tRPC 오류 코드를 읽는데
  // (`data.code`) 업로드는 Route Handler 의 상태 코드로 실패하므로 어휘가 통째로 다르다.
  uploadRun: SubmitInput<FanartUploadValues, FanartUploadResult>["run"];
  mapUploadError: SubmitInput<FanartUploadValues, FanartUploadResult>["mapError"];
};

type ScheduleSaveContext = ScheduleSaveInput & {
  draft: WeekDraft;
  baseline: WeekDraft;
  revision: number | null;
  error: string;
  // 발행·비공개 전환 전용 에러 — error(저장)와 나눈 이유는 파일 상단 주석 참고.
  publishError: string;
  // 팬아트 업로드 전용 에러 — 화면의 다른 자리(팬아트 블록 안)에 뜬다.
  fanartError: string;
  announcement: string;
  // 새 항목 키의 단조 카운터 — core 는 순수라 이 값 자체가 상태다(원본의 useRef 를 대신한다).
  seq: number;
};

type ScheduleSaveEvent =
  | { type: "NOTE_CHANGED"; note: string }
  | { type: "ENTRY_ADDED"; date: string }
  | { type: "ENTRY_REMOVED"; key: string }
  | { type: "ENTRY_PATCHED"; key: string; patch: Parameters<typeof updateEntry>[2] }
  /* 하루의 속성(시각·휴방, 이슈 #117). 항목 이벤트와 갈라 두는 이유는 대상이 다르기 때문이다 —
     항목은 key 로, 하루는 날짜로 지목한다. */
  | { type: "DAY_PATCHED"; date: string; patch: Parameters<typeof setDay>[2] }
  /* 팬아트 셋(ADR-0028). 브랜치 초판(외부 URL)은 두 칸을 patch 하나로 받았지만, R2 판에선 세
     행위가 서로 다르다: 파일을 **올린다**(비동기, 키·치수가 서버에서 온다) · 표기를 **적는다**
     (동기 입력) · 그림을 **내린다**(넷을 함께 지운다). 한 이벤트로 뭉치면 화면이 키를 직접
     만들어 보낼 수 있게 되는데, 키의 출처는 업로드 응답 하나뿐이어야 한다. */
  | { type: "FANART_UPLOAD"; file: Blob }
  | { type: "FANART_CREDIT_CHANGED"; credit: string }
  | { type: "FANART_REMOVED" }
  | { type: "SAVE" }
  | { type: "PUBLISH" }
  | { type: "UNPUBLISH" };

// SAVE 가 자식에게 실어 보낼 값. revision 은 **그 순간 context 의 값**이어야 한다 — 성공 뒤
// 갈아 끼워진 새 revision 이 다음 저장에 실리는 게 CAS 의 핵심이다.
function saveValues(context: ScheduleSaveContext): SaveWeekValues {
  return {
    weekStartDate: context.weekStartDate,
    revision: context.revision,
    note: context.draft.note,
    published: context.draft.published,
    entries: draftEntryInputs(context.draft),
    days: draftDayInputs(context.draft),
    fanartImageKey: context.draft.fanartImageKey,
    // '' → null 은 서버 Zod 도 하지만, dirty 비교가 같은 정규형을 봐야 저장 직후 깨끗해진다
    // (note·startTime 과 같은 규약).
    fanartCredit: context.draft.fanartCredit.trim() || null,
  };
}

// PUBLISH·UNPUBLISH 가 publish 자식에게 실어 보낼 값. revision 은 그 순간 context 의 값이어야
// CAS 가 선다(saveValues 의 revision 과 같은 이유).
function publishValues(context: ScheduleSaveContext, published: boolean): PublishWeekValues {
  return {
    weekStartDate: context.weekStartDate,
    // 가드(canPublish)가 이미 null 을 걸렀다 — 저장된 적 없는 주는 이 이벤트 자체를 못 받는다.
    revision: context.revision as number,
    published,
  };
}

/* PUBLISH 가드. dirty 하면 막는다 — 발행은 항상 baseline(이미 저장된 값)을 대상으로 한다.
   저장된 적이 없으면(revision null — 레거시 아카이브처럼 메타 자체가 없는 주 포함)도 막는다. */
function canPublish(context: ScheduleSaveContext): boolean {
  return context.revision !== null && !isWeekDirty(context.draft, context.baseline);
}

/* UNPUBLISH 가드. **dirty 여부를 안 본다** — PUBLISH 와 달리 비대칭이다. 공개를 거두는 건
   저장된 내용을 새로 공개하는 게 아니라 이미 공개된 걸 내리는 것뿐이라, "이미 저장된 값
   기준"이라는 원칙이 적용될 대상 자체가 없다. 오히려 급히 내려야 하는데 마침 공지를 고치던
   중이라 막히면 안전이 아니라 방해가 된다(Plan 에이전트 리뷰 지적, 2026-07-28). revision 이
   null 이면 발행된 적조차 없는 주라(발행엔 항상 메타 행이 필요) 여전히 막는다. */
function canUnpublish(context: ScheduleSaveContext): boolean {
  return context.revision !== null;
}

export const scheduleSaveMachine = setup({
  types: {} as {
    context: ScheduleSaveContext;
    events: ScheduleSaveEvent;
    input: ScheduleSaveInput;
  },
  actors: { submit: saveSubmitMachine, publish: publishSubmitMachine, upload: uploadSubmitMachine },
}).createMachine({
  id: "scheduleSave",
  context: ({ input }) => ({
    ...input,
    draft: input.initialDraft,
    baseline: input.initialDraft,
    revision: input.initialRevision,
    error: "",
    publishError: "",
    fanartError: "",
    announcement: "",
    seq: 0,
  }),
  // 화면이 사는 동안 죽지 않는 자식 둘 — 파일 상단 "왜 루트인가" 참고.
  invoke: [
    {
      id: "submit",
      src: "submit",
      input: ({ context }) => ({ run: context.run, mapError: context.mapError }),
      onSnapshot: [
        {
          guard: ({ event }) => event.snapshot.matches("done"),
          target: ".ready",
          actions: assign(({ event }) => {
            // matches("done") 이 서라는 건 submit.machine.ts 의 onDone 이 이미 result 를 채웠다는
            // 뜻이다(그 파일의 "done 은 항상 result 를 갖고 진입한다" 계약) — non-null 이 안전하다.
            const result = event.snapshot.context.result!;
            return {
              draft: result.draft,
              baseline: result.draft,
              revision: result.revision,
              error: "",
              /* 요청에 실었던 published 가 아니라 **서버가 되돌려준** 값을 쓴다 — saveWeek 은
                 publishedAt 을 정확히 input.published 여부로만 켜고 끄므로(service.saveWeek)
                 둘은 항상 같다. 굳이 요청 값을 따로 들고 다니지 않는다(정본 하나). */
              announcement: result.draft.published
                ? "일정을 저장하고 발행했습니다"
                : "일정을 저장했습니다(초안)",
            };
          }),
        },
        {
          // idle 로 돌아왔는데 error 가 있다 = submit.machine 의 onError 갈래(submit.machine.ts
          // 참고) — 처음 invoke 될 때도 idle 스냅샷이 한 번 오지만 그때는 error 가 "" 라 안 걸린다.
          guard: ({ event }) =>
            event.snapshot.matches("idle") && event.snapshot.context.error !== "",
          target: ".ready",
          // announcement 는 안 건드린다 — 원본이 실패 시 error 만 세우고 이전 성공 문구를 그대로
          // 두던 것과 같다(다시 라이브 리전이 읽을 이유가 없다, error 문단이 role="alert" 로 이미 뜬다).
          actions: assign({ error: ({ event }) => event.snapshot.context.error }),
        },
      ],
    },
    {
      id: "publish",
      src: "publish",
      input: ({ context }) => ({ run: context.publishRun, mapError: context.mapError }),
      onSnapshot: [
        {
          guard: ({ event }) => event.snapshot.matches("done"),
          target: ".ready",
          actions: assign(({ context, event }) => {
            const result = event.snapshot.context.result!;
            return {
              // published 필드만 병합한다 — entries·note 는 이 뮤테이션이 안 건드렸으므로 draft·
              // baseline 을 통째로 안 갈아 끼운다(publishing 중 들어온 편집을 안 지운다).
              draft: { ...context.draft, published: result.published },
              baseline: { ...context.baseline, published: result.published },
              revision: result.revision,
              publishError: "",
              announcement: result.published ? "발행했습니다" : "비공개로 전환했습니다",
            };
          }),
        },
        {
          guard: ({ event }) =>
            event.snapshot.matches("idle") && event.snapshot.context.error !== "",
          target: ".ready",
          actions: assign({ publishError: ({ event }) => event.snapshot.context.error }),
        },
      ],
    },
    {
      id: "upload",
      src: "upload",
      input: ({ context }) => ({ run: context.uploadRun, mapError: context.mapUploadError }),
      onSnapshot: [
        {
          guard: ({ event }) => event.snapshot.matches("done"),
          target: ".ready",
          actions: assign(({ context, event }) => {
            const result = event.snapshot.context.result!;
            return {
              draft: {
                ...context.draft,
                fanartImageKey: result.key,
                /* **새 그림에 옛 표기를 물려주지 않는다.** 업로드는 매번 새 UUID 를 내므로 키가
                   반드시 바뀌고, 그 상태에서 표기가 남으면 잘못된 귀속이다 — 서버의 같은 규칙
                   (nextFanart 규칙 2)에 맡길 수 없다: 편집기는 표기를 **항상 함께 보내므로**
                   보낸 값이 이겨 그 규칙이 발동하지 않는다. 화면이 지워야 한다. */
                fanartCredit: "",
              },
              fanartError: "",
              /* 업로드만으로는 **어느 주에도 안 걸린다** — 저장을 눌러야 반영된다. 미리보기가
                 떠서 눈으로는 달라 보이므로, 남은 한 걸음은 글자로 말해야 전해진다(팬 제안이
                 "보드를 안 바꾸는 쓰기는 화면이 직접 말해야 한다"로 겪은 자리와 같은 결).

                 **치수 안내는 없다.** 한때 "크기를 못 읽었다"를 여기서 알렸는데, 그건 화면이
                 파일을 디코드하던 시절의 fail-open 때문이었다 — 이제 서버가 헤더를 못 읽으면
                 업로드 자체를 415 로 거절하므로(ADR-0030) 그 상태가 아예 생기지 않는다. */
              announcement: "팬아트를 올렸습니다. 저장해야 반영됩니다.",
            };
          }),
        },
        {
          guard: ({ event }) =>
            event.snapshot.matches("idle") && event.snapshot.context.error !== "",
          target: ".ready",
          actions: assign({ fanartError: ({ event }) => event.snapshot.context.error }),
        },
      ],
    },
  ],
  /* 편집 이벤트 넷은 `ready`·`saving`·`publishing` 어느 쪽에 있든 받는다 — 원본이 저장 중에도
     입력을 안 잠그기 때문이다(파일 상단 주석). PUBLISHED_CHANGED 는 이제 없다 — 발행 체크박스가
     사라졌고 draft.published 는 오직 PUBLISH·UNPUBLISH 성공 시에만 바뀐다. */
  on: {
    NOTE_CHANGED: {
      actions: assign({ draft: ({ context, event }) => ({ ...context.draft, note: event.note }) }),
    },
    ENTRY_ADDED: {
      actions: assign(({ context, event }) => ({
        draft: addEntry(context.draft, makeDraftEntry(newEntryKey(context.seq), event.date)),
        seq: context.seq + 1,
      })),
    },
    ENTRY_REMOVED: {
      actions: assign({ draft: ({ context, event }) => removeEntry(context.draft, event.key) }),
    },
    ENTRY_PATCHED: {
      actions: assign({
        draft: ({ context, event }) => updateEntry(context.draft, event.key, event.patch),
      }),
    },
    DAY_PATCHED: {
      actions: assign({
        draft: ({ context, event }) => setDay(context.draft, event.date, event.patch),
      }),
    },
    /* 표기 입력은 **다른 편집 이벤트와 같은 자리**(루트)다 — 저장 중에도 타이핑을 잠그지 않는
       기존 계약을 그대로 따른다(그 대가도 같다: 저장이 성공하면 서버 응답이 draft 를 덮는다).
       반대로 업로드·내리기는 `ready` 안에 있다(아래) — 그 둘은 업로드 자식과 **같은 값을**
       만지므로 진행 중에 끼면 결과가 순서에 달린다. */
    FANART_CREDIT_CHANGED: {
      actions: assign({
        draft: ({ context, event }) => ({ ...context.draft, fanartCredit: event.credit }),
      }),
    },
  },
  initial: "ready",
  states: {
    ready: {
      on: {
        /* 빈 제목 항목이 있으면 **서버로 안 나가고** ready 에 그대로 머문다(가드 배열의 첫
           갈래, target 없음 — 내부 전이). draftEntryInputs 가 그 항목을 조용히 걸러 버리므로
           (schedule-editor.ts 주석) 안 막으면 저장이 "성공"하고 그 줄이 신호 없이 사라진다. */
        SAVE: [
          {
            guard: ({ context }) => firstBlankTitleEntry(context.draft) !== null,
            actions: assign({
              error: ({ context }) => blankTitleMessage(firstBlankTitleEntry(context.draft)!),
            }),
          },
          {
            target: "saving",
            /* error 를 먼저 지운다 — 안 지우면 실패 뒤 재시도가 (새 요청이 아직 안 끝났는데도)
               옛 실패 문구를 그대로 보여준다(원본 onSave 의 `setError("")` 와 같다, 적대적 리뷰가
               잡은 자리). */
            actions: [
              assign({ error: "" }),
              sendTo("submit", ({ context }) => ({
                type: "submit",
                values: saveValues(context),
              })),
            ],
          },
        ],
        PUBLISH: {
          /* 항목이 아니라 **내용**이 있어야 한다(이슈 #117 결정 9) — 전부 휴방인 주는 항목이
             0개여도 짠 결과라 발행할 만하다. 서버의 weekHasContent 와 같은 규칙이다. */
          guard: ({ context }) => canPublish(context) && draftHasContent(context.baseline),
          target: "publishing",
          actions: [
            assign({ publishError: "" }),
            sendTo("publish", ({ context }) => ({
              type: "submit",
              values: publishValues(context, true),
            })),
          ],
        },
        UNPUBLISH: {
          guard: ({ context }) => canUnpublish(context),
          target: "publishing",
          actions: [
            assign({ publishError: "" }),
            sendTo("publish", ({ context }) => ({
              type: "submit",
              values: publishValues(context, false),
            })),
          ],
        },
        /* 파일을 올린다. 옛 실패 문구를 먼저 지우는 이유는 SAVE 와 같다 — 안 지우면 새 업로드가
           도는 중에도 지난 실패가 그 자리에 남아 있다. */
        FANART_UPLOAD: {
          target: "uploading",
          actions: [
            assign({ fanartError: "" }),
            sendTo("upload", ({ event }) => ({ type: "submit", values: { file: event.file } })),
          ],
        },
        /* 내린다 — **넷을 함께 지운다.** 그림이 없으면 표기도 치수도 가리킬 대상이 없다(서버
           nextFanart·DB CHECK 와 같은 규칙). 화면에서 사라진 값은 데이터에서도 사라지는 게 맞고,
           표기만 남기면 저장이 거절되는데 그 칸이 화면에 없어 관리자가 고칠 수단이 없다. */
        FANART_REMOVED: {
          actions: assign({
            draft: ({ context }) => ({
              ...context.draft,
              fanartImageKey: null,
              fanartCredit: "",
              fanartImageWidth: null,
              fanartImageHeight: null,
            }),
          }),
        },
      },
    },
    // submit 자식이 "submitting" 인 동안 머문다 — 위 onSnapshot 이 결론(done/실패)에서 .ready 로
    // 돌려보낸다. 이 상태 자체엔 on 이 없다 — SAVE 를 다시 보내도 무시된다(submit.machine.ts 의
    // "submitting 상태에선 submit 이벤트를 무시한다" 와 같은 방어).
    saving: {},
    // publish 자식이 "submitting" 인 동안 머문다 — saving 과 같은 결.
    publishing: {},
    /* upload 자식이 바이트를 보내는 동안 머문다. **`on` 이 비어 있는 것이 이 상태의 일이다** —
       SAVE 가 여기서 무시되므로 "아직 키가 없는 draft 가 저장되는" 경로가 닫힌다(그러면 관리자는
       올린 그림이 안 걸린 것을 업로드 실패로 읽는다). 팬아트 조작(FANART_UPLOAD·FANART_REMOVED)도
       같은 이유로 여기서 안 받는다 — 자식과 같은 값을 만져 결과가 순서에 달린다. */
    uploading: {},
  },
});
