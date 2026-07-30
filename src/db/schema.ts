/* v1 데이터 모델(ADR-0014). 네 테이블 모두 surrogate 정수 PK — 이식성·외부 식별자 비노출
   ·균일 조인. enum 값은 core 상수(ROLES)에서 끌어와 타입·DB CHECK 가 한 원천을
   공유한다. 초기 마이그레이션엔 무결성 제약(PK·UNIQUE·CHECK·FK)만 넣는다 — 정렬·필터용
   성능 인덱스는 v1(<100행)에서 측정 불가라 검색 feature 이슈로 미룬다(ADR-0014). */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ROLES } from "@/core/authorities";
import { SUGGESTION_KINDS, SUGGESTION_STATUSES } from "@/core/suggestions";

/* 모든 타임스탬프는 epoch ms(정수)로 저장한다 — SQLite 엔 offsetDateTime/timestamptz 가
   없다. KST 는 표시 경계에서 Asia/Seoul 포매터로 보장한다(한국은 DST 없어 고정 +9).
   created_at/last_updated_at 은 앱이 단일 진실원으로 채운다($defaultFn/$onUpdate = Worker
   런타임 값) — "SQLite DEFAULT 는 UTC" 함정을 피한다. played_at/cleared_at 은 관리자
   입력값(과거 가능·nullable)이라 자동 생성이 아니다. */
const createdAt = () =>
  integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now());
const lastUpdatedAt = () =>
  integer("last_updated_at")
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdate(() => Date.now());

/* 내부 신원 앵커. OAuth 결합도 0 — 다른 로그인 수단이 붙어도 이 테이블은 안 바뀐다.
   표시명은 여기가 아니라 oauth_accounts.channel_name 에 있다(제공자가 준 값이라 그쪽이 제자리).
   ADR-0014 는 "표시명은 DB 아님 → 세션에만"이었지만 ADR-0017 이 뒤집었다: refresh 회전 때
   access 를 재서명하려면 표시명이 필요한데 치지직 토큰을 안 들고 있어 재조회가 불가능하다. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: createdAt(),
  lastUpdatedAt: lastUpdatedAt(),
});

/* 로그인 수단 1개 = 1행. users 1 : N. 치지직 토큰(access/refresh)은 저장하지 않는다(ADR-0006):
   로그인 1회 신원확인 후 자체 JWT 로 넘어간다. provider_user_id 는 치지직 channelId(안정
   식별자)이자 자연키 — UNIQUE(provider, provider_user_id)로 재연결·중복 로그인을 막고
   로그인 조회 핫패스를 인덱스 없이도 커버한다. channel_name 은 표시명 스냅샷(로그인 시 갱신):
   access(15분)가 만료돼 proxy 가 refresh 로 새 access 를 서명할 때 표시명이 필요한데, 치지직
   토큰이 없어 재조회가 불가하므로 여기 캐시한다(rotation 이 신원을 재구성할 수 있게). */
export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["chzzk"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    channelName: text("channel_name"),
    createdAt: createdAt(),
    lastUpdatedAt: lastUpdatedAt(),
  },
  (t) => [
    unique().on(t.provider, t.providerUserId),
    // enum 옵션은 타입만 좁힌다 — DB 도 보증하도록 CHECK 를 겹쳐 둔다(확장 대비).
    check("oauth_accounts_provider", sql`${t.provider} IN ('chzzk')`),
  ],
);

/* 역할 "부여(grant)" M:N. 상승 역할(admin·superadmin)만 저장한다 — member 는 암묵 기본값
   (행 없음). PK(user_id, role)가 중복 부여를 막고 인가 핫패스를 커버한다. role → authority
   매핑은 DB 가 아니라 src/core 코드 상수다(ADR-0014). */
export const usersRoles = sqliteTable(
  "users_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.role] }),
    check("users_roles_role", sql`${t.role} IN ('admin', 'superadmin')`),
  ],
);

/* 역할 변경 감사(ADR-0012·0014·0018). 사람 주도 역할 부여·회수를 남긴다 — 누가(actor)
   누구에게(target) 무슨 역할을 grant/revoke 했나. 부트스트랩(SUPERADMIN_CHANNEL_ID)은 env
   로부터 재구성 가능해 기록하지 않는다(ADR-0014). append-only 로그라 수정·삭제가 없어
   last_updated_at 이 없다(created_at 만). surrogate PK·epoch ms·enum CHECK 겹침은 다른
   테이블과 같은 컨벤션. action 은 로컬 리터럴, role 은 core ROLES 를 단일 원천으로 끌어온다. */
export const roleAuditLogs = sqliteTable(
  "role_audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => users.id),
    targetUserId: integer("target_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action", { enum: ["grant", "revoke"] }).notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("role_audit_logs_action", sql`${t.action} IN ('grant', 'revoke')`),
    check("role_audit_logs_role", sql`${t.role} IN ('admin', 'superadmin')`),
  ],
);

/* 게임 보드(ADR-0015). 치지직 category API 스냅샷을 denormalize 해 공개 읽기가 외부 API·
   인증에 무관하게 한다.

   플레이 날짜의 정본은 더 이상 여기에 없다 — 일정(schedule_entries)이 정본이고 보드의
   "언제 플레이했나"는 그 항목들의 MAX(scheduled_date)로 유도한다(이슈 #56 결정 3·17,
   ADR-0019 보강). 그래서 played_at 컬럼을 드롭했다: 같은 게임을 여러 날 플레이한 편성
   ("월·화 젤다")이 컬럼 하나로는 표현 불가였고, 일정에 항목이 여럿 서면 공짜로 담긴다.

   클리어는 게임 자체의 사실이라 여기 남는다(플레이 날짜와 달리 편성에 묶이지 않는다).
   cleared_at → cleared_date 로 이름을 바꾸고 cleared 플래그를 더했다 — "깼는데 날짜 모름"
   (실데이터에 있다: 할로우 나이트)을 표현하려면 플래그가 날짜와 독립이어야 하기 때문이다.
   CHECK(cleared = 1 OR cleared_date IS NULL) 로 "안 깼는데 클리어 날짜가 있는" 모순만 막고,
   깬 채 날짜가 null 인 건 허용한다. 클리어 = cleared 플래그(cleared_date 유무가 아니다 —
   그 둘을 동일시하면 날짜 모르는 클리어가 표현 불가로 되돌아간다).

   cleared_date 는 정수 epoch 가 아니라 text 'YYYY-MM-DD' 다: 시각이 아니라 달력의 하루라
   타임존이 개입하면 KST 자정 근처에서 하루가 밀린다(core/games.ts·AGENTS.md 명명 규약).
   사전순 = 시간순이라 ORDER BY 도 그대로 선다.

   category_id 는 nullable — 치지직 검색에 없는 게임을 손으로 넣을 수 있어야 한다(그땐
   외부 키가 없다). UNIQUE 는 유지한다: SQLite 는 NULL 중복을 허용하므로 "한 치지직
   카테고리 = 보드 1회"는 그대로 서고 수동 입력만 제약 밖으로 빠진다.

   삭제는 하드 삭제(deleted_at 없음) — 확인 다이얼로그가 파괴 **전**에 멈추므로 서버에 닿은
   삭제는 이미 의도된 삭제고 되돌릴 대상이 없다(ADR-0020 이 "지연 커밋이라 영속할 필요 없다"는
   옛 근거를 대체했다). 소프트 삭제를 안 쓰는 이유는 그대로다: v1 에 복구 휴지통·삭제 감사
   요구가 없는데 모든 조회가 WHERE deleted_at IS NULL 을 영구히 지불한다. */
export const games = sqliteTable(
  "games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: text("category_id").unique(),
    categoryType: text("category_type", { enum: ["GAME"] }).notNull(),
    categoryValue: text("category_value").notNull(),
    posterImageUrl: text("poster_image_url"),
    // boolean 모드 — 0/1 로 저장하되 타입은 boolean 으로 흐른다. 아래 CHECK 는 SQL 값(0/1)을
    // 본다. 클리어 여부의 정본이라 not null·기본 false(새 게임은 아직 안 깬 상태).
    cleared: integer("cleared", { mode: "boolean" }).notNull().default(false),
    clearedDate: text("cleared_date"),
    createdAt: createdAt(),
    lastUpdatedAt: lastUpdatedAt(),
  },
  (t) => [
    check("games_category_type", sql`${t.categoryType} = 'GAME'`),
    // 안 깬 게임에 클리어 날짜가 붙는 모순만 막는다. cleared=1·date=null(날짜 모름)은 허용.
    check("games_cleared_date", sql`${t.cleared} = 1 OR ${t.clearedDate} IS NULL`),
  ],
);

/* 방송 일정 정본(이슈 #56). 캘린더와 주간표는 이 항목들을 월/주로 그린 두 뷰다 — 동기화
   코드가 필요 없다(애초에 하나라서, 결정 1). 게임 플레이 날짜도 여기서 유도한다(결정 3):
   game_id 있는 항목이 곧 "그 게임을 그날 했다".

   scheduled_date 는 "달력의 하루"라 text 'YYYY-MM-DD'(순간이 아니다 — AGENTS.md 명명 규약,
   games.cleared_date 와 같은 근거). 주(week)는 저장하지 않고 이 날짜에서 유도한다(결정 2,
   core/calendar.weekStartOf) — 항목에 week_id FK 를 두면 날짜와 어긋난 주가 저장 가능해진다.
   하루에 항목이 여럿 설 수 있다(UNIQUE 없음).

   **start_time 은 여기 없다 — 시각은 하루의 속성이다**(이슈 #117, #56 결정 8 을 뒤집었다).
   옛 근거는 "오후 저챗 + 밤 게임" 편성을 담는 것이었는데 그런 편성이 실재하지 않는 것으로
   확인됐다(2026-07-29). 하루에 방송은 하나고 항목은 그 방송에서 할 것들의 목록이라, 항목마다
   시각을 두면 같은 값을 하루 안에서 반복해 적고 서로 다른 값이 들어갈 자리가 열린다.
   시각의 새 자리는 아래 schedule_days 다.

   game_id → games.id ON DELETE SET NULL: 게임을 보드에서 떼도 그날 방송이 있었다는 사실은
   남는다(항목은 자유 제목 title 로 자립한다). 항목 종류 컬럼은 두지 않는다(결정 9) —
   game_id 유무 + 자유 title 로 충분하고, 종류가 필요해지면 그때 연다(ADR-0010 JIT).
   성능 인덱스는 v1(<100행)에서 미룬다(ADR-0014). */
export const scheduleEntries = sqliteTable("schedule_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduledDate: text("scheduled_date").notNull(),
  title: text("title").notNull(),
  gameId: integer("game_id").references(() => games.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  lastUpdatedAt: lastUpdatedAt(),
});

/* 하루의 속성(이슈 #117). 방송 시작 시각과 휴방 여부 — 둘 다 **항목이 아니라 하루**에 달린
   사실이다. 항목 테이블에 두면 하루 안에서 같은 값이 반복되고, 주 메타에 두면 7일치 컬럼이
   필요하다. 그래서 하루가 개체가 된다.

   scheduled_date 는 형제(schedule_entries)와 같은 이름·같은 타입이다 — 계속 조인할 자리라
   이름이 갈리면 매번 매핑을 기억해야 한다. UNIQUE: 하루 = 한 행.

   start_time 은 'HH:MM' KST 라벨이고 nullable(NULL = 시각 미정 — 편성은 있는데 몇 시인지 아직
   안 정한 정상 상태다). rest 는 휴방(쉬기로 정한 날).

   ── **행이 없는 것 = 기본값**(결정 3) ─────────────────────────────────────────────
   `start_time NULL` + `rest 0` 은 행이 아예 없는 것과 **같은 뜻**이고, 그래서 서비스는 기본값인
   날의 행을 아예 안 만든다. ADR-0024 가 비싸게 배운 규율이다(#64): 부재를 도메인 상태로 쓰면
   그 행이 다른 이유로 필요해지는 순간 겸직이 터진다 — 여기선 그 반대로 **기본값이 부재와 같은
   뜻이 되게** 컬럼을 잡아, 행을 언제 만들든 도메인이 안 흔들리게 한다.

   ── 휴방과 항목의 공존은 CHECK 로 못 막는다 ────────────────────────────────────────
   둘이 다른 테이블이라 SQLite 제약이 닿지 않는다. **표시에서 휴방이 이긴다**(결정 5) — 저장은
   그대로 두고 화면에서만 가리므로, 실수로 휴방을 켰다 꺼면 항목이 그대로 돌아온다. 지우는
   쪽을 택하면 그 실수가 복구 불가가 된다. 알고 수용한 한계라 여기 적어 둔다. */
export const scheduleDays = sqliteTable("schedule_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduledDate: text("scheduled_date").notNull().unique(),
  startTime: text("start_time"),
  // boolean 모드 — 0/1 로 저장하되 타입은 boolean 으로 흐른다(games.cleared 와 같은 컨벤션).
  // 기본 false 가 "행 없음"과 같은 뜻이라, 행 생성이 도메인 상태를 안 흔든다.
  rest: integer("rest", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  lastUpdatedAt: lastUpdatedAt(),
});

/* 주 메타(이슈 #56 결정 2·13). 주 자체는 날짜에서 유도하므로(schedule_entries 참조) 이
   테이블엔 항목이 안 들어간다 — 한 주에 딸린 부가 정보(공지 한 줄·발행 시각)만 든다.
   week_start_date 는 그 주의 월요일 'YYYY-MM-DD'(core/calendar.weekStartOf 로 정규화)이고
   UNIQUE — 한 주 = 한 메타 행.

   **주의 상태는 축이 둘이고 서로 독립이다**(ADR-0022, 이슈 #64 가 연 자리):
     draft        — 아직 짜는 중인가. 게임 보드가 이 축 하나만 읽는다.
     published_at — 대외 공개했나(nullable 순간, epoch ms). /schedule 이 이 축 하나만 읽는다.

   한 축(published_at)으로 둘을 겸하던 시절엔 "메타 행이 없다"가 **레거시 아카이브**라는 도메인
   사실까지 겸직했다. 그래서 낙관적 동시성(CAS) 때문에 행을 만드는 순간 도메인 상태가 딸려
   왔다 — 게임 폼이 레거시 주의 항목을 연결 해제하면 그 주가 발행된 채 생겨 시각·자유 제목까지
   공개됐다(이슈 #64). draft 의 **DEFAULT 0 이 "행 없음"과 같은 뜻**이라 그 겸직이 끊긴다:
   행을 언제 만들든 도메인 상태가 안 변해서, 청구(claimWeek)가 부작용 없는 연산이 된다.

   그래서 보드 유도는 `coalesce(w.draft, 0) = 0` 한 축만 본다(LEFT JOIN 미스 = 기본값과 합류).
   3상태 enum 을 안 쓰는 이유는 ADR-0019 의 원칙 그대로다 — status 는 (draft, published_at)의
   함수라 저장 대상이 아니다. 반대로 draft 는 published_at 에서 파생되지 않는 독립 사실이다.

   CHECK 는 모순 조합 하나만 막는다: 짜는 중인데 공개된 주는 없다. 반대(draft=0·미발행)는
   정상 상태다 — 과거 아카이브와 게임 폼이 만든 주가 거기 산다(보드엔 뜨고 공개는 안 된다). */
export const scheduleWeeks = sqliteTable(
  "schedule_weeks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    weekStartDate: text("week_start_date").notNull().unique(),
    note: text("note"),
    // boolean 모드 — 0/1 로 저장하되 타입은 boolean 으로 흐른다(games.cleared 와 같은 컨벤션).
    // 기본 false 가 "메타 행 없음"과 같은 뜻이라, 새 행이 도메인 상태를 안 흔든다.
    draft: integer("draft", { mode: "boolean" }).notNull().default(false),
    publishedAt: integer("published_at"),
    /* 그 주에 걸어 둘 팬아트(ADR-0028). 주에 딸린 부가 정보라 note 와 같은 자리다.

       **URL 이 아니라 R2 객체 키다** — `<uuid>.<ext>` 한 조각이고, prefix(`fanart/`)와 서빙
       경로(`/api/fanart/…`)는 코드가 붙인다(core/fanart.ts 가 형식의 정본). 컬럼이 URL 이면
       외부 호스트를 가리키는 행을 문법적으로 막을 수단이 없는데, 이 기능이 R2 로 옮겨온 이유가
       정확히 그 유출(방문자 IP 가 남의 서버로 간다)이다. 키는 호스트를 표현할 수 없다.

       credit 은 작가 표기 문자열이다. 링크가 아니라 이름만 받는다 — 링크를 받으면 그 URL 도
       검증·새 창 처리·대비를 따로 져야 하는데, 팬아트 한 장에 그만한 배선을 붙일 근거가 아직
       없다(ADR-0010 JIT). 필요해지면 그때 연다. */
    fanartImageKey: text("fanart_image_key"),
    fanartCredit: text("fanart_credit"),
    /* 그림의 픽셀 치수. 읽기 화면이 `<img width height>` 로 **자리를 미리 예약**하는 데만 쓴다 —
       없으면 lazy 로드가 끝나는 순간 그 아래(푸터)가 밀린다. 치수를 값으로 들고 있어야 하는 건
       서빙 경로가 바이트를 안 만지기 때문이다(ADR-0028): 응답 어디에도 폭·높이가 없다.

       **nullable 이다 — 키가 있어도 치수는 필수가 아니다.** 이 값은 관리자 브라우저가 파일에서
       읽어 보내는데(createImageBitmap), 브라우저가 못 디코드하는 파일이면 못 읽는다. 필수로
       걸면 그때 저장이 통째로 막혀 **그림은 올라갔는데 어느 주에도 걸 수 없는** 상태가 된다.
       치수는 데이터의 진실이 아니라 레이아웃 힌트라, 없으면 예약을 안 하는 저하가 맞다.

       서버가 안 읽는 이유: 형식별로 PNG IHDR·JPEG SOF·WebP VP8X 헤더를 훑어야 하고 그건
       ADR-0028 이 그은 "요청 경로에서 이미지를 만지지 않는다"에 닿는다. 클라이언트 주장이지만
       위조돼도 어긋나는 것은 레이아웃뿐이다(바이트·형식은 업로드가 매직 바이트로 판정한다). */
    fanartImageWidth: integer("fanart_image_width"),
    fanartImageHeight: integer("fanart_image_height"),
    createdAt: createdAt(),
    lastUpdatedAt: lastUpdatedAt(),
  },
  (t) => [
    check("schedule_weeks_draft", sql`${t.draft} = 0 OR ${t.publishedAt} IS NULL`),
    /* 작가 표기만 있고 그림이 없는 조합을 막는다 — 그러면 화면에 아무것도 안 뜨는데 값만
       남아, 다음 사람이 "왜 안 보이지"를 데이터에서 찾게 된다. 반대(그림만 있고 표기 없음)는
       정상이다: 작가를 모르거나 본인이 그린 경우가 있다. */
    check(
      "schedule_weeks_fanart",
      sql`${t.fanartCredit} IS NULL OR ${t.fanartImageKey} IS NOT NULL`,
    ),
    /* 치수는 **한 쌍이고 그림에 딸린다.** 셋을 막는다: 한쪽만 있는 행(예약 계산이 성립하지
       않는다) · 그림 없이 치수만 있는 행(가리킬 그림이 없다) · 0 이하(나눗셈·비율이 깨진다).
       `(w IS NULL) = (h IS NULL)` 이 SQLite 에서 서는 것은 스크래치 sqlite 로 확인했다
       (`IS NULL` 이 0/1 을 내므로 `=` 비교가 성립 — 실측 2026-07-30). */
    check(
      "schedule_weeks_fanart_size",
      sql`(${t.fanartImageWidth} IS NULL) = (${t.fanartImageHeight} IS NULL)
          AND (${t.fanartImageWidth} IS NULL
               OR (${t.fanartImageKey} IS NOT NULL
                   AND ${t.fanartImageWidth} > 0 AND ${t.fanartImageHeight} > 0))`,
    ),
  ],
);

/* 팬 수정 제안(ADR-0025). 보드의 쓰기는 상승 역할 전용인데(ADR-0012), 방송을 실제로 본 팬이
   "이거 깼어요"를 전할 길이 없었다 — 이 테이블이 로그인의 첫 대가다. 제안은 게임을 **안 바꾼다**:
   관리자가 제안함에서 보고 기존 수정 폼(updateGame)으로 반영하므로 쓰기 경로는 그대로 하나다.

   두 종류가 한 테이블에 산다(kind — core/suggestions.ts 가 정본):
     edit — 보드에 있는 카드를 고쳐 달라. game_id 가 대상이고 proposed_* 가 목표 상태다.
     add  — 없는 게임을 올려 달라. 대상이 아직 없으니 proposed_title 로 이름만 말한다.
   치지직 검색은 비관리자에게 안 연다(client_credentials 노출 — features/chzzk/router.ts). 그래서
   추가 요청은 자유 이름이고, 정본 카테고리는 관리자가 반영할 때 컴포저에서 정한다.

   제안 값은 부분 patch 가 아니라 **목표 상태 스냅샷**이라 셋이 늘 함께 실린다 — 게임 폼의
   playedDate 가 "키의 유무"로 세 상태를 가르느라 물었던 함정(games/schema.ts 의 playDateInput)을
   되풀이하지 않는다. proposed_played_date 는 games 컬럼이 아니라 일정을 뜻한다(정본은
   schedule_entries) — 반영이 곧 게임 폼의 날짜 입력이라 그쪽 규칙을 그대로 탄다.

   note 는 값으로 표현 못 하는 제보의 유일한 길이다(제목 오타·포스터가 다른 게임 — 관리자도 폼으로
   못 고치는 스냅샷 필드라 글로만 전할 수 있다). 그래서 값 변경 없이 note 만 있는 제안도 유효하다.

   날짜 둘은 '달력의 하루'라 text 'YYYY-MM-DD', resolved_at 만 진짜 순간이라 epoch ms 다
   (AGENTS.md 명명 규약 — games.cleared_date 와 같은 근거). */
export const gameSuggestions = sqliteTable(
  "game_suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: SUGGESTION_KINDS }).notNull(),
    /* ON DELETE CASCADE — 게임이 보드에서 사라지면 그 게임을 고쳐 달라던 제안은 반영할 대상이
       없다. **SET NULL 이면 안 된다**: kind='edit' 인데 game_id 가 NULL 인 행은 아래 CHECK 를
       깨서 게임 삭제 자체가 실패한다(그리고 그 규칙을 풀면 수정 제안이 추가 요청으로 둔갑한다). */
    gameId: integer("game_id").references(() => games.id, { onDelete: "cascade" }),
    authorUserId: integer("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    proposedTitle: text("proposed_title"),
    // boolean 모드 — games.cleared 와 같은 컨벤션(0/1 저장, 타입은 boolean). 아래 CHECK 는 SQL 값을 본다.
    proposedCleared: integer("proposed_cleared", { mode: "boolean" }).notNull().default(false),
    proposedClearedDate: text("proposed_cleared_date"),
    proposedPlayedDate: text("proposed_played_date"),
    note: text("note"),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("pending"),
    resolvedAt: integer("resolved_at"),
    resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    lastUpdatedAt: lastUpdatedAt(),
  },
  (t) => [
    // enum 옵션은 타입만 좁힌다 — DB 도 보증하도록 CHECK 를 겹친다(다른 테이블과 같은 규약).
    check("game_suggestions_kind", sql`${t.kind} IN ('edit', 'add')`),
    check("game_suggestions_status", sql`${t.status} IN ('pending', 'accepted', 'rejected')`),
    /* 종류마다 채워지는 자리가 다르다. 섞인 행(대상도 있고 이름도 있는)이 저장 가능하면
       제안함이 무엇을 그릴지 화면에서 갈린다. */
    check(
      "game_suggestions_shape",
      sql`(${t.kind} = 'edit' AND ${t.gameId} IS NOT NULL AND ${t.proposedTitle} IS NULL)
          OR (${t.kind} = 'add' AND ${t.gameId} IS NULL AND ${t.proposedTitle} IS NOT NULL)`,
    ),
    // games_cleared_date 와 같은 규칙 — 반영하는 순간 게임 쪽 CHECK 가 거절할 조합을 미리 막는다.
    check(
      "game_suggestions_cleared_date",
      sql`${t.proposedCleared} = 1 OR ${t.proposedClearedDate} IS NULL`,
    ),
    /* "처리됐다"와 "처리 흔적이 있다"는 같은 뜻이어야 한다. 한쪽만 쓰는 경로가 생기면
       제안함 목록(pending 필터)과 감사(누가 언제 처리했나)가 서로 다른 집합을 본다. */
    check(
      "game_suggestions_resolution",
      sql`(${t.status} = 'pending' AND ${t.resolvedAt} IS NULL AND ${t.resolvedByUserId} IS NULL)
          OR (${t.status} <> 'pending' AND ${t.resolvedAt} IS NOT NULL AND ${t.resolvedByUserId} IS NOT NULL)`,
    ),
    /* 한 사람이 한 게임에 **처리 안 된 제안 하나**. 없으면 같은 사람의 같은 제보가 제안함을
       채워 관리자가 무엇을 읽어야 할지 잃는다. 부분 인덱스라 처리된 제안은 제약 밖으로 빠져
       (같은 게임에 두 번째 제안을 낼 수 있다) 이력이 쌓이는 걸 막지 않는다.
       추가 요청(game_id NULL)은 대상이 없어 이 제약이 성립하지 않으므로 조건에서 뺀다 —
       SQLite 는 NULL 중복을 허용해 어차피 안 걸리지만, 명시해야 인덱스가 뜻을 말한다. */
    uniqueIndex("game_suggestions_open_per_author")
      .on(t.gameId, t.authorUserId)
      .where(sql`${t.status} = 'pending' AND ${t.gameId} IS NOT NULL`),
  ],
);

/* 자체 세션 refresh 토큰(ADR-0017). access 는 stateless(EdDSA JWT, DB 무관)라 여기 없다 —
   refresh 만 서버가 정본으로 들고 rotation·재사용 감지·revoke 를 한다. 원본은 저장하지 않고
   sha256 해시만(DB 유출 시 재사용 방지). family_id 는 로그인 1회(디바이스) 단위 rotation 체인,
   family_expires_at 은 sliding 위의 절대 상한(첫 로그인 + 90일, rotation 시 승계).
   무효화가 두 종류다: superseded_at = 회전으로 대체됨(후계 있음 — grace 내 재사용은 정상 동시 탭),
   revoked_at = 세션 폐기(로그아웃·도난 — 재사용 절대 불가). 둘을 하나로 합치면 로그아웃 직후
   grace 창에서 폐기된 토큰이 되살아난다. 유효 = 둘 다 NULL.
   후계 원본은 **저장하지 않는다.** grace 내 재사용에 같은 후계를 멱등 반환해야 동시 탭이 수렴하지만
   (새로 찍으면 도둑이 무제한 증식해 도난 탐지가 무력화된다), 그 값을 컬럼에 두면 *현재 활성*
   토큰의 평문이 DB 에 남는다 — 초판이 그렇게 했다가 적대적 리뷰에 배포 차단으로 걸렸다. 지금은
   구 토큰에서 서버 비밀로 재계산한다(tokens.deriveSuccessorToken). append/무효화만이라
   last_updated_at 없음.
   인덱스는 rotation 조회 핫패스(family_id·user_id)에 필요하다. */
export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    familyExpiresAt: integer("family_expires_at").notNull(),
    supersededAt: integer("superseded_at"),
    revokedAt: integer("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("refresh_tokens_family_id").on(t.familyId),
    index("refresh_tokens_user_id").on(t.userId),
  ],
);

/* 보안 이벤트 감사(ADR-0017). 지금은 refresh 도난 감지(reuse-theft)만 남긴다 — 도난은 유일한
   침해 신호라 console.warn 휘발 로그로 흘리지 않고 지속 저장한다(누가·언제 당했나 사후 질의).
   role_audit_logs 는 action IN('grant','revoke')·actor/target NOT NULL 구조라 재사용 불가해
   별도 테이블을 둔다. append-only. */
export const securityEvents = sqliteTable("security_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  familyId: text("family_id"),
  eventType: text("event_type", { enum: ["refresh_reuse"] }).notNull(),
  createdAt: createdAt(),
});

// 스키마가 타입의 정본이다(ADR-0004): 여기서 흐른 타입이 features·tRPC·Zod 로 이어진다.
export type User = typeof users.$inferSelect;
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type UserRole = typeof usersRoles.$inferSelect;
export type RoleAuditLog = typeof roleAuditLogs.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
export type ScheduleEntry = typeof scheduleEntries.$inferSelect;
export type NewScheduleEntry = typeof scheduleEntries.$inferInsert;
export type ScheduleDay = typeof scheduleDays.$inferSelect;
export type NewScheduleDay = typeof scheduleDays.$inferInsert;
export type ScheduleWeek = typeof scheduleWeeks.$inferSelect;
export type NewScheduleWeek = typeof scheduleWeeks.$inferInsert;
export type GameSuggestionRow = typeof gameSuggestions.$inferSelect;
export type NewGameSuggestionRow = typeof gameSuggestions.$inferInsert;
