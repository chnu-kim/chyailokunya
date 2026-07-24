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

/* 같은 날짜 입력이되 **기본값이 없다** — 안 보내면 통과가 아니라 오류다. playedDate 처럼
   "null = 지운다"가 실제 삭제로 이어지는 자리에 dateInput 을 그대로 쓰면 필드를 빠뜨린 호출자가
   조용히 일정 항목을 지운다(수정 폼이 한 필드를 안 실었을 뿐인데 날짜가 사라진다). 기본값을
   없애면 그 실수가 타입·런타임 양쪽에서 즉시 걸린다 — "안 보냄"과 "지움"을 구분하는 유일한
   방법이 필수화다(부분 patch 를 안 쓰기로 한 결정의 짝). */
const requiredDateInput = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().refine(isIsoDate, "YYYY-MM-DD 형식의 실재하는 날짜여야 해요").nullable(),
);

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
   세 필드 모두 명시적으로 보낸다(부분 patch 아님) — optional 로 두면 "안 보냄"과 "지움"이
   구분되지 않는다. playedDate 가 null 이면 그 게임의 일정 항목을 **지운다**(날짜를 비우는 것이
   곧 "그날 안 했다"이므로). 이게 부분 patch 를 안 쓰는 대가이자 이유다.

   playedDate 는 games 컬럼이 아니라 일정 항목으로 간다 — 정본은 그대로 schedule_entries 다
   (addGameInput 주석). **여러 날 편성된 게임은 서버가 변경을 거절한다**(core.isPlayDateEditable):
   입력 하나로 여러 날을 표현할 수 없어서다. 폼도 같은 판정으로 입력을 잠그지만, 잠금은 편의고
   진짜 방어선은 서버다(불변식 3).

   cleared 가 false 인데 clearedDate 가 있으면 거절한다(DB CHECK 의 Zod 짝, core.isClearedStateValid).
   "깼는데 날짜 모름"(cleared=true·date=null)은 통과한다 — 그 표현을 살리는 게 플래그를 날짜와
   독립으로 둔 이유다. */
export const updateGameInput = z
  .object({
    id: z.number().int().positive(),
    cleared: z.boolean(),
    clearedDate: dateInput,
    // 기본값 없는 쪽을 쓴다 — 안 보내면 삭제로 읽히는 필드라(requiredDateInput 주석).
    playedDate: requiredDateInput,
  })
  .refine((v) => isClearedStateValid(v.cleared, v.clearedDate), {
    // path 를 clearedDate 에 준다 — 폼이 어느 입력 아래에 오류를 띄울지 알아야 한다.
    message: "클리어 표시를 해야 클리어한 날짜를 넣을 수 있어요",
    path: ["clearedDate"],
  });
export type UpdateGameInput = z.infer<typeof updateGameInput>;

// 편집용 날짜 조회 입력 = surrogate 정수 PK. 응답이 초안 주까지 담으므로 권한은 라우터가 건다.
export const playDatesInput = z.object({ id: z.number().int().positive() });

// 삭제 입력 = surrogate 정수 PK.
export const removeGameInput = z.object({ id: z.number().int().positive() });
export type RemoveGameInput = z.infer<typeof removeGameInput>;
