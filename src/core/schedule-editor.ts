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

   startTime 은 'HH:MM'(KST) 또는 ''(미정)이다 — <input type=time> 이 이 둘만 낸다(로케일과
   무관하게 24시간 값, date-input 과 달리 표시도 값도 흔들리지 않는다). 서버가 '' 를 null 로
   접으므로(saveWeekInput.startTime) 여기선 '' 를 그대로 들고 다닌다(중복 정규화 금지). */
export type DraftEntry = {
  key: string;
  scheduledDate: string;
  startTime: string;
  title: string;
  gameId: number | null;
};

/* 주 하나의 편집 상태. entries 는 요일 구분 없이 한 배열로 들고, 그리기·저장 때 날짜로 가른다
   (항목의 주 소속 정본은 scheduledDate 다 — 결정 2, week_id 를 안 둔다). */
export type WeekDraft = {
  note: string;
  published: boolean;
  entries: DraftEntry[];
};

/* 저장 페이로드의 한 줄. saveWeekInput.entries[] 와 구조 동형이다 — core 가 Zod·features 를
   못 봐서 타입을 잇지 못하고 shape 만 맞춘다. startTime 은 여기서 '' → null 로 접어 넘긴다:
   서버 Zod 도 접지만, 이 함수의 반환이 "저장될 값"이라 dirty 비교(isWeekDirty)가 서버와 같은
   정규형을 봐야 저장 직후 draft 가 깨끗해진다. */
export type DraftEntryInput = {
  scheduledDate: string;
  startTime: string | null;
  title: string;
  gameId: number | null;
};

/* 새 항목의 안정 키. 호출자가 단조 증가 seq(useRef 카운터)를 넘긴다 — core 는 순수 함수라
   상태를 못 들고, Math.random/Date.now 없이 충돌 없는 키가 나오려면 이 규율이어야 한다. */
export function newEntryKey(seq: number): string {
  return `new-${seq}`;
}

/* 그 날짜의 빈 항목 하나. 시각·제목·게임은 편집기가 채운다 — 자유 편성(gameId null·제목만)이
   기본이라 게임 연결은 선택으로 둔다. */
export function makeDraftEntry(key: string, scheduledDate: string): DraftEntry {
  return { key, scheduledDate, startTime: "", title: "", gameId: null };
}

export function addEntry(draft: WeekDraft, entry: DraftEntry): WeekDraft {
  return { ...draft, entries: [...draft.entries, entry] };
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

/* 하루 안 정렬 — 시각 있는 항목 먼저(오름차순), 미정('')은 끝. **서버 getWeekForEdit 의 SQL
   ORDER BY 와 같은 규칙이어야 한다**: 편집기는 저장 전 이 순서로 미리 그리고, 저장 후엔 서버가
   같은 순서로 되돌려줘야 화면이 안 튄다. 둘이 갈리면 저장 순간 항목이 재배열돼 보인다.
   같은 시각(또는 둘 다 미정)은 원래 배열 순서를 지킨다(안정 정렬) — 서버의 3차 키 id 순에
   대응하는, "먼저 더한 게 먼저"다. */
export function entriesForDate(draft: WeekDraft, date: string): DraftEntry[] {
  return draft.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.scheduledDate === date)
    .sort((a, b) => {
      const at = a.e.startTime;
      const bt = b.e.startTime;
      if (at === bt) return a.i - b.i;
      if (at === "") return 1; // 미정은 끝으로
      if (bt === "") return -1;
      return at < bt ? -1 : 1;
    })
    .map(({ e }) => e);
}

/* 저장 페이로드의 entries. 제목은 trim, 시각 '' 는 null 로 접는다(정규형). 제목이 빈 항목은
   버린다 — 자유 편성인데 제목이 없으면 서버 min(1)에 걸릴 뿐 아니라 화면에 이름 없는 줄이
   남는다. 게임 연결 항목은 편집기가 제목을 게임명으로 채우므로 여기 안 걸린다. */
export function draftEntryInputs(draft: WeekDraft): DraftEntryInput[] {
  return draft.entries
    .map((e) => ({
      scheduledDate: e.scheduledDate,
      startTime: e.startTime.trim() === "" ? null : e.startTime,
      title: e.title.trim(),
      gameId: e.gameId,
    }))
    .filter((e) => e.title !== "");
}

/* 저장하면 달라지는가 — 미저장 이탈 경고와 "저장" 버튼 활성의 판단축이다. **저장될 값**끼리
   비교한다: key·항목 배열 순서·빈 항목은 저장에 안 실리므로 무시하고, note·published 와
   draftEntryInputs 의 정규형(제목 trim·시각 접힘)만 본다. 순서 무관이라 같은 날 두 항목의
   입력 순서가 달라도 같은 주로 저장되면 dirty 가 아니다 — 정규 직렬화를 정렬해 비교한다. */
export function isWeekDirty(a: WeekDraft, b: WeekDraft): boolean {
  if (a.note.trim() !== b.note.trim()) return true;
  if (a.published !== b.published) return true;
  return canonicalEntries(a) !== canonicalEntries(b);
}

function canonicalEntries(draft: WeekDraft): string {
  return JSON.stringify(
    draftEntryInputs(draft)
      .map((e) => [e.scheduledDate, e.startTime, e.title, e.gameId] as const)
      .sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)),
  );
}
