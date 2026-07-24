/* 쓰기 입력의 Zod 계약(ADR-0004·불변식 2). 클라이언트는 신뢰하지 않는다 — 모든 쓰기가 이
   경계를 통과한 뒤 인가·저장으로 간다. 컴포저 폼도 이 스키마를 재사용할 수 있다. */

import { z } from "zod";
import { isIsoDate } from "@/core/calendar";
import { isClearedStateValid } from "@/core/games";

/* 날짜 입력 = 'YYYY-MM-DD' 이면서 **실재하는** 날짜. 형식만 보면 2026-02-31 이 통과해
   저장된 뒤 표시 경계에서야 굴러간다(3/3) — 실재 검증까지 core 가 한다. 빈 문자열은
   null 로 접는다: 폼의 빈 <input type="date"> 가 "" 를 보내는데, "날짜 없음"의 표현이
   ""와 null 두 가지가 되면 표시·검증 분기가 갈린다. posterImageUrl 과 같은 preprocess 패턴.
   미래 날짜는 허용한다 — 발매 예정작을 미리 올릴 수 있다. */
const dateInput = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().refine(isIsoDate, "YYYY-MM-DD 형식의 실재하는 날짜여야 해요").nullable().default(null),
);

/* 같은 날짜 입력이되 **기본값이 없다.** 세 상태를 값이 아니라 키의 유무로 가른다:

     필드 없음(undefined) → 일정을 **안 건드린다**
     null                → 그 게임의 일정 항목을 **지운다**
     'YYYY-MM-DD'        → 그 날짜로 **설정한다**

   초판은 이걸 필수로 두고 "안 바꾸려면 기존 날짜를 그대로 되보내라"고 했다가 실제로 깨졌다:
   여러 날 편성이라 날짜 입력이 잠긴 폼은 되보낼 값이 하나로 정해지지 않아 빈 문자열을 실었고,
   그게 null 로 접혀 "여러 날을 지우려 한다"로 거절됐다 — **클리어만 고치려는 저장이 전부
   실패했다**(codex 리뷰가 잡았다). 값 하나에 "편집값"과 "변경 없음"을 겹쳐 실은 게 뿌리였다.

   키의 부재로 옮기면 둘이 안 겹치고, 빠뜨린 호출자도 **지우는 게 아니라 안 건드린다** —
   실수가 데이터 손실이 아니라 무동작으로 떨어진다(필수화가 노리던 안전을 반대 방향에서
   얻는다). 부분 patch 를 피한다는 원칙은 cleared·clearedDate 에 그대로 살아 있다. */
const playDateInput = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().refine(isIsoDate, "YYYY-MM-DD 형식의 실재하는 날짜여야 해요").nullable(),
  )
  .optional();

/* 추가 입력 = 치지직 category 스냅샷 4필드 + 플레이 날짜. **날짜의 정본은 여전히 일정
   (schedule_entries)이다**(이슈 #56 결정 3) — 이 필드는 games 컬럼으로 돌아가지 않고 서버가
   그 날짜의 일정 항목을 만드는 데 쓴다(service.addGame). 게임 폼은 정본을 옮기는 게 아니라
   **또 하나의 입구**다: 한때 이 단계가 없어 새 게임의 날짜를 붙이려면 /games 에서 추가한 뒤
   /schedule 로 건너가야 했는데, 그 왕복이 "추가할 때 날짜를 못 넣는다"로 드러났다.
   비워 두면(null) 항목을 안 만든다 — 날짜를 모르는 게임을 먼저 올릴 수 있어야 한다.
   categoryType 은 GAME 리터럴로 못박아 보드 불변식을 입력 경계에서 강제한다(DB CHECK 와 이중).
   categoryId·poster 는 nullable — categoryId 가 null 인 건 검색에 없어 손으로 넣은 게임이다.

   이 스키마가 category 4필드 정규화(trim·empty→null·GAME 필터·상한)의 유일한 정본이다.
   features/chzzk/client.ts::toCategory 는 다른 경계다: 치지직 검색 응답(신뢰 안 되는 외부
   JSON)을 타입으로 좁히는 파싱이고, 저장 시 정규화는 여전히 여기서만 한다. */
export const addGameInput = z.object({
  /* trim 후 non-empty — 공백만·패딩 값(' abc ')이 빈 카드로 저장되거나 'abc'/' abc ' 로
     category_id UNIQUE 를 우회하는 걸 입력 경계에서 막는다.

     .max(200) — 한때 64였는데 **프로덕션에서 실제로 터졌다.** 치지직 categoryId 는 짧은
     숫자가 아니라 영문 원제를 그대로 옮긴 슬러그다: 「레이튼 미스터리 저니」처럼 원제가 긴
     게임은 64 를 그냥 넘어가 games.add 가 BAD_REQUEST/too_big 으로 죽었다(사용자가 멀쩡한
     게임을 못 올렸다). 제목에서 나오는 값이니 상한도 제목과 같은 자리(200)에 둔다. 상한 자체는
     남긴다: list 가 공개·무페이지네이션이라 위조 클라이언트가 초대형 행으로 응답을 부풀릴 수 있다.

     nullable — 검색에 없어 손으로 넣은 게임엔 치지직 키가 없다. 빈 문자열은 null 로 접는다:
     ''가 그대로 저장되면 두 번째 수동 입력이 UNIQUE 로 충돌한다(NULL 만 중복이 허용된다). */
  categoryId: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().min(1).max(200).nullable().default(null),
    )
    .describe("치지직 categoryId. 수동 입력 게임은 null"),
  categoryType: z.literal("GAME"),
  // .max(200) — 치지직 categoryValue(게임 제목) 실측 대비 여유. 이유는 categoryId 와 동일.
  categoryValue: z.string().trim().min(1).max(200),
  // 빈 문자열은 저장 전에 null 로 접는다(preprocess) — "포스터 없음"의 유일한 표현은 null
  // 이어야 카드 렌더의 이니셜 폴백 분기(poster 유무)가 하나로 맞는다. .max(2048) 은 URL
  // 길이 상한, https 스킴 강제는 별개 이유: game-board 가 이 값을 그대로 <img src> 로
  // 렌더하므로 javascript:/data: 등 비-http(s) 스킴이 들어오면 XSS 로 이어진다.
  posterImageUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .regex(/^https:\/\//, "https URL 이어야 해요")
      .nullable()
      .default(null),
  ),
  // 플레이 날짜(선택) — 있으면 서버가 이 날짜의 일정 항목을 게임과 **한 batch** 로 만든다.
  playedDate: dateInput,
});
export type AddGameInput = z.infer<typeof addGameInput>;

/* 수정 입력 — 클리어 상태와 플레이 날짜. 제목·포스터·categoryId 는 치지직 스냅샷(또는 최초
   수동 입력)이라 여기서 못 바꾼다: 스냅샷을 사후 편집할 수 있게 하면 categoryId 와 표시명이
   갈라져 "이 카드가 어느 게임인가"가 흐려진다.
   cleared·clearedDate 는 늘 함께 보낸다(부분 patch 아님) — optional 로 두면 "안 보냄"과
   "지움"이 구분되지 않는다. playedDate 만 다른 규약을 쓴다: 값이 아니라 **키의 유무**로 세
   상태를 가른다(playDateInput 주석 — 없음=안 건드림 · null=지움 · 날짜=설정).

   playedDate 는 games 컬럼이 아니라 일정 항목으로 간다 — 정본은 그대로 schedule_entries 다
   (addGameInput 주석). **여러 날 편성된 게임에 날짜를 실어 보내면 서버가 거절한다**
   (core.isPlayDateEditable): 입력 하나로 여러 날을 표현할 수 없어서다. 그 경우 폼은 필드를
   아예 안 실어 클리어만 고친다. 잠금은 편의고 진짜 방어선은 서버다(불변식 3).

   cleared 가 false 인데 clearedDate 가 있으면 거절한다(DB CHECK 의 Zod 짝, core.isClearedStateValid).
   "깼는데 날짜 모름"(cleared=true·date=null)은 통과한다 — 그 표현을 살리는 게 플래그를 날짜와
   독립으로 둔 이유다. */
export const updateGameInput = z
  .object({
    id: z.number().int().positive(),
    cleared: z.boolean(),
    clearedDate: dateInput,
    /* 안 보내면 "일정을 안 건드린다" — 여러 날 편성이라 폼이 날짜를 잠근 저장과, 사용자가
       날짜 칸을 아예 안 건드린 저장이 이 길로 온다(playDateInput 주석의 회귀). */
    playedDate: playDateInput,
    /* playedDate 를 실을 때 **함께 보내는 precondition** — 폼이 열릴 때 읽은 날짜다. 서버가
       현재 항목과 대조해 다르면 CONFLICT 로 거절한다(낙관적 동시성, saveWeek 의 revision 과
       같은 결).

       왜 필요한가: 폼은 열릴 때 날짜를 로컬 상태로 읽는다. 그 사이 다른 관리자가 /schedule
       에서 그 항목을 옮기면, 클리어만 고친 저장이 **stale 한 날짜를 되돌려 놓는다** — 남의
       일정 작업이 조용히 사라진다(적대적 리뷰 6라운드). 폼이 "안 바뀌었으면 안 싣는다"로도
       대부분 막히지만 그건 클라이언트 신뢰라, 진짜 방어선은 여기 둔다(불변식 3). */
    playedDateWas: playDateInput,
  })
  .refine((v) => isClearedStateValid(v.cleared, v.clearedDate), {
    // path 를 clearedDate 에 준다 — 폼이 어느 입력 아래에 오류를 띄울지 알아야 한다.
    message: "클리어 표시를 해야 클리어한 날짜를 넣을 수 있어요",
    path: ["clearedDate"],
  })
  /* 날짜를 바꾸겠다면 "무엇에서 바꾸는지"를 반드시 함께 말해야 한다 — precondition 없이
     playedDate 만 오면 서버가 stale 여부를 판단할 수 없다. 키가 하나만 실린 요청은 규약을
     모르는 호출자이므로 입력 경계에서 막는다. */
  .refine((v) => (v.playedDate === undefined) === (v.playedDateWas === undefined), {
    message: "플레이 날짜를 바꿀 땐 열었을 때의 날짜도 함께 보내야 해요",
    path: ["playedDateWas"],
  });
export type UpdateGameInput = z.infer<typeof updateGameInput>;

// 편집용 날짜 조회 입력 = surrogate 정수 PK. 응답이 초안 주까지 담으므로 권한은 라우터가 건다.
export const playDatesInput = z.object({ id: z.number().int().positive() });

// 삭제 입력 = surrogate 정수 PK.
export const removeGameInput = z.object({ id: z.number().int().positive() });
export type RemoveGameInput = z.infer<typeof removeGameInput>;
