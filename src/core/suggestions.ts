/* 팬 수정 제안의 도메인 판정(ADR-0025) — 순수 로직(HTTP·DB·React 무관).

   제안이 담는 건 **게임의 목표 상태 스냅샷**이지 부분 patch 가 아니다. 세 값(클리어 플래그·
   클리어한 날·플레이한 날)이 늘 함께 실린다 — addGameInput 이 부분 patch 를 안 쓰는 것과 같은
   이유이고(지울 이전 상태가 없다), 게임 폼의 playedDate 가 "키의 유무"로 세 상태를 가르느라
   물었던 함정(features/games/schema.ts 의 playDateInput 주석)을 제안 쪽에 되풀이하지 않는다.

   **제안 당시의 보드 값은 저장하지 않는다.** 관리자가 반영 시점에 판단하는 건 "지금 값과 무엇이
   다른가"이고, 그 사이 누가 이미 고쳤으면 차이가 비어 "바뀔 게 없다"로 보이는 게 정확하다 —
   과거 스냅샷을 들고 있으면 오히려 이미 낡은 diff 를 관리자에게 보여준다. */

import { isClearedStateValid } from "./games";

/* 제안의 종류. **`game_id` 의 유무로 파생하지 않고 컬럼으로 명시한다** — 이슈 #64 에서 "행의
   부재"를 도메인 상태로 썼다가 그 행이 다른 이유로 필요해지며 겸직이 터졌고(schedule_weeks 의
   draft 컬럼이 그 처방이다), 여기도 같은 모양이다: 게임을 지우면 edit 제안의 game_id 가 NULL 로
   풀리는 FK 규칙(SET NULL)을 언젠가 누가 고르는 순간 수정 제안이 통째로 추가 요청으로 둔갑한다.
   지금은 CASCADE 라 그 경로가 없지만, 파생을 안 쓰면 그 선택 자체가 도메인을 못 흔든다.

   ROLES 와 같은 규약이다 — 이 배열이 타입·DB enum·CHECK 의 단일 원천이고 db/schema 가 import 한다. */
export const SUGGESTION_KINDS = ["edit", "add"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/* 제안의 처리 상태. 셋은 서로 배타적이고 **다른 컬럼에서 파생되지 않는다** — ADR-0019·0024 가
   "status 는 저장 대상이 아니다"라고 적은 건 그것이 (draft, published_at) 의 함수였기 때문이고,
   여기선 거절이 독립된 사실이라 그 논리가 성립하지 않는다(반영과 거절은 둘 다 "처리됨"인데
   해결 시각만으로는 어느 쪽인지 알 수 없다). */
export const SUGGESTION_RESOLUTIONS = ["accepted", "rejected"] as const;
export type SuggestionResolution = (typeof SUGGESTION_RESOLUTIONS)[number];

// 처리 상태 전체 = 미처리 + 처리 결과. 파생해 두면 결과가 하나 늘 때 두 목록이 갈리지 않는다.
export const SUGGESTION_STATUSES = ["pending", ...SUGGESTION_RESOLUTIONS] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/* 제안이 말하는 목표 상태. 날짜 둘은 '달력의 하루'라 text 'YYYY-MM-DD'(AGENTS.md 명명 규약) —
   "모름"의 표현은 null 하나뿐이다(빈 문자열은 입력 경계에서 접힌다). */
export type SuggestedValues = {
  cleared: boolean;
  clearedDate: string | null;
  playedDate: string | null;
};

/* 지금 보드가 그리는 값. playedDate 자리에 lastPlayed 를 받는 이유는 그것이 **팬에게 보이는
   유일한 플레이 날짜**이기 때문이다(발행 경계를 통과한 MAX — features/games/service 의
   lastPlayedExpr). 초안 주까지 세는 playDates 는 game:write 를 요구하므로 제안하는 쪽도, 이
   비교도 그 값을 못 본다. 여러 날 편성의 잠금은 관리자가 반영하려고 폼을 여는 순간 걸린다. */
export type CurrentValues = {
  cleared: boolean;
  clearedDate: string | null;
  lastPlayed: string | null;
};

/* 바뀌는 값 하나. field 별로 from/to 타입이 갈리므로 union 이다 — 하나로 뭉뚱그려 string 으로
   두면 화면이 boolean 을 날짜처럼 포매팅하는 실수가 타입으로 안 걸린다. */
export type SuggestionChange =
  | { field: "cleared"; from: boolean; to: boolean }
  | { field: "clearedDate"; from: string | null; to: string | null }
  | { field: "playedDate"; from: string | null; to: string | null };

/* 제안이 실제로 바꾸는 것만 추린다. 관리자 제안함이 "현재 → 제안"을 그리는 자리이고, 안 바뀌는
   줄까지 다 그리면 세 줄 중 무엇을 봐야 하는지가 화면에서 사라진다.

   클리어를 푸는 제안이면 clearedDate 는 따로 세지 않는다 — 플래그가 내려가면 날짜는 딸려서
   비는 것이라(games CHECK 의 규칙) 별도 변경으로 세면 관리자가 두 줄을 읽고 같은 사실을 두 번
   판단한다. 반대로 플래그는 그대로인 채 날짜만 바뀌는 건 독립된 변경이라 그대로 센다. */
export function diffSuggestion(
  current: CurrentValues,
  proposed: SuggestedValues,
): SuggestionChange[] {
  const changes: SuggestionChange[] = [];

  if (current.cleared !== proposed.cleared) {
    changes.push({ field: "cleared", from: current.cleared, to: proposed.cleared });
  }
  // 플래그가 내려가는 제안에선 날짜 줄을 접는다(위 주석). 올라가거나 유지될 때만 날짜를 센다.
  if (proposed.cleared && current.clearedDate !== proposed.clearedDate) {
    changes.push({ field: "clearedDate", from: current.clearedDate, to: proposed.clearedDate });
  }
  if (current.lastPlayed !== proposed.playedDate) {
    changes.push({ field: "playedDate", from: current.lastPlayed, to: proposed.playedDate });
  }

  return changes;
}

/* 아무 말도 안 하는 제안인가 — 값이 지금과 전부 같고 한마디도 비었다. 입력 경계에서 거절한다:
   관리자 제안함에 뜨는 순간 그 줄은 읽을 것도 반영할 것도 없어 순수한 소음이고, 게임당 사람당
   pending 하나라는 제약(부분 UNIQUE 인덱스)의 그 한 자리를 잡아먹는다.

   **한마디만 있는 제안은 유효하다.** 값으로 표현 못 하는 제보가 실재한다 — 제목 오타·포스터가
   다른 게임 같은 것들은 관리자도 폼으로 못 고치는 스냅샷 필드라(features/games/schema.ts 의
   updateGameInput 주석) 글로만 전할 수 있다. 값 변경을 필수로 두면 그 제보의 길이 막힌다. */
export function isEmptyEditSuggestion(
  current: CurrentValues,
  proposed: SuggestedValues,
  note: string | null,
): boolean {
  return diffSuggestion(current, proposed).length === 0 && (note === null || note.trim() === "");
}

/* 제안 값 자체가 성립하는가 — 안 깬 게임에 클리어 날짜가 붙는 모순만 막는다. games 의 CHECK·
   Zod 와 **같은 함수**를 나눠 쓴다: 여기만 따로 짜면 제안으로는 저장 가능한데 반영하려는
   순간 게임 쪽 경계가 거절하는 조합이 생겨, 관리자가 손쓸 수 없는 제안이 제안함에 남는다. */
export function isSuggestedValuesValid(proposed: SuggestedValues): boolean {
  return isClearedStateValid(proposed.cleared, proposed.clearedDate);
}
