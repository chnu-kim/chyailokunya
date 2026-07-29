/* 주간 편집기의 순수 상태와 전이(이슈 #56 작업순서 6). HTTP·DB·React 무관 — 편집기 클라이언트
   컴포넌트는 그리기·통신만 하고, "항목을 더하면·빼면·시각을 바꾸면 무엇이 되는가"는 여기서
   단위 테스트로 못박는다(games-composer 리듀서와 같은 취지: 전이 버그를 DOM 없이 잡는다).

   ── core 경계 때문에 shape 만 맞춘다 ────────────────────────────────────────────────
   core 는 features·db 를 못 본다(의존 아래로만). 그래서 WeekView·ScheduleEntry·SaveWeekInput
   같은 features 타입을 여기서 참조하지 않고, 구조만 같은 core 소유 타입을 둔다. 로드된 주를
   Draft 로 옮기는 변환(ScheduleEntry → DraftEntry)은 이 shape 를 아는 app 레이어가 맡는다. */

/* 편집 중인 항목 하나. key 는 안정 로컬 식별자다 — DB 항목은 'db-{id}', 새로 더한 항목은
   'new-{seq}'. id 가 없는 새 항목도 React 리스트·편집 지목이 안정 키를 필요로 하고, 전체 교체
   저장이라 key 자체는 서버로 안 나간다.

   **시각은 여기 없다 — 하루의 속성이다**(이슈 #117, #56 결정 8 을 뒤집었다). DraftDay 참조. */
export type DraftEntry = {
  key: string;
  scheduledDate: string;
  title: string;
  gameId: number | null;
};

/* 하루의 속성(이슈 #117). startTime 은 'HH:MM'(KST) 또는 ''(미정)이다 — <input type=time> 이
   이 둘만 낸다(로케일과 무관하게 24시간 값, date-input 과 달리 표시도 값도 안 흔들린다).
   서버가 '' 를 null 로 접으므로(saveWeekInput) 여기선 '' 를 그대로 들고 다닌다(중복 정규화 금지). */
export type DraftDay = {
  startTime: string;
  rest: boolean;
};

/* 기본값인 하루 — 시각 미정 · 휴방 아님. DB 에서 "행이 없는 것"과 같은 뜻이다(db/schema.ts). */
export const EMPTY_DAY: DraftDay = { startTime: "", rest: false };

/* 그날 첫 항목을 만들 때 세우는 시각. 매번 타이핑하는 반복 마찰을 없애려는 것이고(이슈 #56
   결정 20), 저녁 방송이 실사용 최빈값이다. 자리만 항목에서 하루로 옮겨 그대로 승계한다. */
export const DEFAULT_START_TIME = "19:00";

/* 주 하나의 편집 상태. entries 는 요일 구분 없이 한 배열로 들고, 그리기·저장 때 날짜로 가른다
   (항목의 주 소속 정본은 scheduledDate 다 — 결정 2, week_id 를 안 둔다).

   days 는 날짜 → 속성 맵이다. 배열이 아닌 이유: 같은 날이 두 번 들어갈 자리를 아예 없애고
   (서버 Zod 도 중복을 거절한다), 화면이 날짜로 바로 찾게 한다. 기본값인 날은 **키가 없어도
   된다** — dayOf 가 없으면 EMPTY_DAY 를 준다. */
export type WeekDraft = {
  note: string;
  published: boolean;
  entries: DraftEntry[];
  days: Record<string, DraftDay>;
  /* 그 주 팬아트(이슈 #117). 서버가 '' 를 null 로 접으므로 여기선 '' 를 그대로 들고 다닌다
     (note·startTime 과 같은 규약 — 중복 정규화 금지). */
  fanartImageUrl: string;
  fanartCredit: string;
};

/* 그 날짜의 속성. 키가 없으면 기본값 — "행이 없는 것 = 기본값"을 클라이언트에서도 그대로 쓴다. */
export function dayOf(draft: WeekDraft, date: string): DraftDay {
  return draft.days[date] ?? EMPTY_DAY;
}

/* 하루 속성의 부분 갱신. 기본값으로 되돌아간 날은 **키를 지운다** — 남겨 두면 dirty 비교가
   "{}" 와 "{날짜: 기본값}" 을 다르게 보아, 켰다 끈 휴방이 저장할 것 없는 변경으로 남는다. */
export function setDay(draft: WeekDraft, date: string, patch: Partial<DraftDay>): WeekDraft {
  const next = { ...dayOf(draft, date), ...patch };
  const days = { ...draft.days };
  if (next.startTime === "" && !next.rest) delete days[date];
  else days[date] = next;
  return { ...draft, days };
}

/* 저장 페이로드의 한 줄. saveWeekInput.entries[] 와 구조 동형이다 — core 가 Zod·features 를
   못 봐서 타입을 잇지 못하고 shape 만 맞춘다. startTime 은 여기서 '' → null 로 접어 넘긴다:
   서버 Zod 도 접지만, 이 함수의 반환이 "저장될 값"이라 dirty 비교(isWeekDirty)가 서버와 같은
   정규형을 봐야 저장 직후 draft 가 깨끗해진다. */
export type DraftEntryInput = {
  scheduledDate: string;
  title: string;
  gameId: number | null;
};

/* 저장 페이로드의 하루 한 줄. saveWeekInput.days[] 와 구조 동형이다(core 가 Zod·features 를
   못 봐서 shape 만 맞춘다 — DraftEntryInput 과 같은 사정). */
export type DraftDayInput = {
  scheduledDate: string;
  startTime: string | null;
  rest: boolean;
};

/* 새 항목의 안정 키. 호출자가 단조 증가 seq(useRef 카운터)를 넘긴다 — core 는 순수 함수라
   상태를 못 들고, Math.random/Date.now 없이 충돌 없는 키가 나오려면 이 규율이어야 한다. */
export function newEntryKey(seq: number): string {
  return `new-${seq}`;
}

/* 그 날짜의 빈 항목 하나. 제목·게임은 편집기가 채운다 — 자유 편성(gameId null·제목만)이
   기본이라 게임 연결은 선택으로 둔다. 시각은 여기 없다(하루의 속성이다 — addEntry 참조). */
export function makeDraftEntry(key: string, scheduledDate: string): DraftEntry {
  return { key, scheduledDate, title: "", gameId: null };
}

/* 항목을 더한다. 그날 시각이 **아직 미정이고 휴방도 아니면** 기본값을 세운다 — 항목을 만드는
   행동이 곧 "이날 방송한다"라서, 시각을 매번 따로 타이핑하게 하면 결정 20 이 없애려던 마찰이
   그대로 돌아온다. 이미 정해 둔 시각은 안 건드린다(그날 두 번째 항목이 시각을 되돌리면 안 된다).
   휴방인 날도 안 건드린다 — 휴방에 시작 시각을 붙이는 건 뜻이 안 맞는다. */
export function addEntry(draft: WeekDraft, entry: DraftEntry): WeekDraft {
  const day = dayOf(draft, entry.scheduledDate);
  const withEntry = { ...draft, entries: [...draft.entries, entry] };
  if (day.startTime !== "" || day.rest) return withEntry;
  return setDay(withEntry, entry.scheduledDate, { startTime: DEFAULT_START_TIME });
}

export function removeEntry(draft: WeekDraft, key: string): WeekDraft {
  return { ...draft, entries: draft.entries.filter((e) => e.key !== key) };
}

/* 부분 갱신 — 지목한 항목의 필드만 바꾼다. key 는 못 바꾼다(정체성이라 patch 에서 뺀다). */
export function updateEntry(
  draft: WeekDraft,
  key: string,
  patch: Partial<Omit<DraftEntry, "key">>,
): WeekDraft {
  return {
    ...draft,
    entries: draft.entries.map((e) => (e.key === key ? { ...e, ...patch } : e)),
  };
}

/* 하루 안 정렬 — **입력 순서 그대로**다. 시각이 하루로 올라가면서(이슈 #117) 항목마다 있던
   1·2차 정렬 키가 사라졌고, 남은 규칙은 "먼저 더한 게 먼저" 하나다.

   **서버 getWeekForEdit 의 SQL ORDER BY 와 같은 규칙이어야 한다**(거기선 `날짜 · id`): 편집기는
   저장 전 이 순서로 미리 그리고, 저장 후엔 서버가 같은 순서로 되돌려줘야 화면이 안 튄다.
   둘이 갈리면 저장 순간 항목이 재배열돼 보인다 — 한쪽을 고치면 반드시 다른 쪽도 고친다. */
export function entriesForDate(draft: WeekDraft, date: string): DraftEntry[] {
  return draft.entries.filter((e) => e.scheduledDate === date);
}

/* 제목이 빈 항목을 찾는다 — 저장·발행 전 가드용(이슈 #56, Plan 에이전트 리뷰 2026-07-28).
   아래 draftEntryInputs 는 이런 항목을 **조용히** 걸러 저장 페이로드에서 뺀다 — 그 자체는
   맞는 동작이지만(제목 없는 자유 편성은 서버가 거절할 값이라 애초에 안 보내는 게 맞다), 저장이
   성공하면 draft·baseline 이 서버 응답으로 통째 교체되므로(schedule-save.machine.ts) 그 결과
   이 placeholder 행이 안내 한 줄 없이 화면에서 사라진다. "+항목 추가"로 만든 뒤 제목을 깜빡한
   행이 저장을 누르는 순간 조용히 지워지는 걸 막으려면 draftEntryInputs 보다 **먼저** 봐야 한다.
   처음 걸리는 항목 하나만 돌려준다(한 번에 하나씩 고치게 안내한다 — 여러 개를 한 문장에 나열하면
   어느 요일 이야기인지 흐려진다). */
export function firstBlankTitleEntry(draft: WeekDraft): DraftEntry | null {
  return draft.entries.find((e) => e.title.trim() === "") ?? null;
}

/* 저장 페이로드의 entries. 제목은 trim, 시각 '' 는 null 로 접는다(정규형). 제목이 빈 항목은
   버린다 — 자유 편성인데 제목이 없으면 서버 min(1)에 걸릴 뿐 아니라 화면에 이름 없는 줄이
   남는다. 게임 연결 항목은 편집기가 제목을 게임명으로 채우므로 여기 안 걸린다. 이 필터를 타기
   **전에** 저장 시도 자체를 막고 싶으면 위 firstBlankTitleEntry 를 먼저 쓴다. */
export function draftEntryInputs(draft: WeekDraft): DraftEntryInput[] {
  return draft.entries
    .map((e) => ({
      scheduledDate: e.scheduledDate,
      title: e.title.trim(),
      gameId: e.gameId,
    }))
    .filter((e) => e.title !== "");
}

/* 저장 페이로드의 days. **기본값인 날은 뺀다** — 서버도 같은 필터를 다시 걸지만(saveWeek),
   여기서 접어야 dirty 비교(isWeekDirty)가 서버와 같은 정규형을 봐서 저장 직후 draft 가
   깨끗해진다(draftEntryInputs 와 같은 사정). 날짜순으로 정렬해 키 순서가 비교에 안 새게 한다. */
export function draftDayInputs(draft: WeekDraft): DraftDayInput[] {
  return Object.entries(draft.days)
    .map(([scheduledDate, d]) => ({
      scheduledDate,
      startTime: d.startTime.trim() === "" ? null : d.startTime,
      rest: d.rest,
    }))
    .filter((d) => d.startTime !== null || d.rest)
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : 1));
}

/* 이 주에 **관리자가 무언가 정해 뒀는가** — 발행 가능 여부의 판단축이다(이슈 #117 결정 9).
   전에는 "항목이 하나라도 있나"였는데, 휴방이 생기면서 그 등식이 깨졌다: 7일을 전부 휴방으로
   정한 주는 항목이 0개지만 짠 결과이고 발행할 만하다. 서버(features/schedule/service 의
   weekHasContent)와 **같은 규칙**이어야 한다 — 갈리면 화면은 발행 버튼을 열어 주는데 서버가
   거절하거나, 그 반대가 된다. core 는 features 를 못 보므로(레이어 경계) 규칙을 여기 한 번 더
   적되, 어느 쪽을 고치든 다른 쪽도 같이 고친다. */
export function draftHasContent(draft: WeekDraft): boolean {
  return draftEntryInputs(draft).length > 0 || draftDayInputs(draft).some((d) => d.rest);
}

/* 저장하면 달라지는가 — 미저장 이탈 경고와 "저장" 버튼 활성의 판단축이다. **저장될 값**끼리
   비교한다: key 와 빈 항목은 저장에 안 실리므로 무시하고, note·published·하루 속성과
   draftEntryInputs 의 정규형(제목 trim)만 본다. **항목 순서는 이제 저장될 값이다** —
   시각이 하루로 올라가며 배열 순서가 곧 표시·저장 순서가 됐다(canonicalEntries 주석). */
export function isWeekDirty(a: WeekDraft, b: WeekDraft): boolean {
  if (a.note.trim() !== b.note.trim()) return true;
  if (a.published !== b.published) return true;
  // 팬아트도 저장되는 값이다 — 빼먹으면 주소를 넣어도 저장 버튼이 안 열린다(하루 속성과 같은 자리).
  if (a.fanartImageUrl.trim() !== b.fanartImageUrl.trim()) return true;
  if (a.fanartCredit.trim() !== b.fanartCredit.trim()) return true;
  /* **하루 속성도 저장되는 값이다**(이슈 #117) — 빼먹으면 시각을 바꾸거나 휴방을 켜도 저장
     버튼이 계속 비활성이고, 같은 판정을 읽는 다운로드 카드의 미저장 힌트도 조용해진다. */
  if (canonicalDays(a) !== canonicalDays(b)) return true;
  return canonicalEntries(a) !== canonicalEntries(b);
}

/* **순서를 지켜 비교한다.** 시각이 하루로 올라가기 전에는 하루 안 정렬이 시각으로 결정돼
   배열 순서가 저장 결과에 안 남았고, 그래서 여기서 정렬해 "같은 날 두 항목의 입력 순서가 달라도
   같은 주"로 봤다. 이제는 **배열 순서가 곧 표시 순서이자 저장 순서**다(entriesForDate·서버
   ORDER BY 가 둘 다 입력 순) — 정렬해서 비교하면 순서만 바꾼 편집이 dirty 로 안 잡혀 저장
   버튼이 잠긴 채 새 순서를 영영 못 남긴다(코드 리뷰 지적). */
function canonicalEntries(draft: WeekDraft): string {
  return JSON.stringify(
    draftEntryInputs(draft).map((e) => [e.scheduledDate, e.title, e.gameId] as const),
  );
}

// draftDayInputs 가 이미 기본값을 접고 날짜순으로 정렬한다 — 그대로 직렬화하면 정규형이다.
function canonicalDays(draft: WeekDraft): string {
  return JSON.stringify(draftDayInputs(draft));
}
