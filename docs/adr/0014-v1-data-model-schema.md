# ADR-0014: v1 데이터 모델 & 스키마 (users · oauth_accounts · users_roles · games)

- 상태: Accepted
- 날짜: 2026-07-18

> **보완:** 여기서 Phase 4 로 미룬 **역할 변경 감사 로그**는 [ADR-0018](./0018-role-audit-and-elevation-guard.md)
> 이 `role_audit_logs` 테이블로 실현했다.
>
> **뒤집힘:** 삭제의 "되돌리기 = 클라이언트 지연 커밋"은 [ADR-0020](./0020-delete-confirm-dialog-replaces-undo-window.md)
> 이 **확인 다이얼로그**로 바꿨다. **하드 삭제 결론은 유지**된다 — 아래 지연 커밋 문장은 애초에
> 그 결론을 지지하던 근거가 아니었다(진짜 근거는 이 문서의 소프트 삭제 기각 사유 둘이다).

## 맥락

Phase 3 는 D1+Drizzle([ADR-0003](./0003-d1-drizzle.md)) 위에 실제 스키마를 세운다. v1 정박점
(공용 게임 보드 + 역할 기반 쓰기)을 지탱하되, 이 저장소 원칙(검증 가능성 우선 · YAGNI/JIT
[ADR-0010](./0010-verification-first-jit-abstraction.md) · 계약이 타입 정본)과 맞물려야 한다.

`/grill-me` 설계 세션에서 아래 제약이 확정됐다:

- 테이블 이름은 **복수형**, 불가산명사 지양.
- **모든 테이블 surrogate 정수 PK** — RDB 이식성 · 외부 식별자 비노출(보안) · 조회 성능.
- **users ↔ OAuth 분리** — 훗날 다른 OAuth 로그인 수단이 붙을 수 있으니 `users` 는 OAuth
  결합도 0. 한 유저가 다수 로그인 수단 보유 가능(현재는 치지직만).
- **모든 타임스탬프는 KST 기준.** `users`·`games` 는 `created_at`·`last_updated_at` 보유.
- `games` 는 이후 검색이 붙는다(필터 keyword·status, 정렬 이름·수정·추가). 상세 게임 정보의
  정보원은 [ADR-0015](./0015-chzzk-category-as-game-source.md)(치지직 category API).

## 결정

네 테이블을 둔다. 모두 surrogate 정수 PK, 복수형 이름:

```
users             내부 신원 앵커. OAuth 결합도 0.
  id                integer PK
  created_at        integer(ms) NOT NULL      -- 레코드 생성(앱 자동)
  last_updated_at   integer(ms) NOT NULL      -- 레코드 수정(앱 자동)
  -- 표시명(치지직 channelName)은 DB 아님 → JWT 세션에만. 다른 유저를 화면에
  -- 노출하지 않는 v1 에선 이름을 DB 에서 조회할 일이 없다.

oauth_accounts    로그인 수단 1개 = 1행. users 1 : N.
  id                integer PK
  user_id           integer FK → users.id
  provider          text NOT NULL   CHECK(provider IN ('chzzk'))   -- 확장 대비
  provider_user_id  text NOT NULL   -- 치지직 channelId(안정 식별자)
  created_at        integer(ms) NOT NULL      -- 연결 시각
  last_updated_at   integer(ms) NOT NULL
  UNIQUE(provider, provider_user_id)          -- 계정 재연결·중복 로그인 방지 + 로그인 조회
  -- 토큰(access/refresh) 저장 안 함(ADR-0006): 로그인 1회 신원확인 후 자체 JWT.

users_roles       역할 "부여(grant)" M:N. 상승 역할만 저장.
  user_id           integer FK → users.id
  role              text NOT NULL   CHECK(role IN ('admin','superadmin'))
  created_at        integer(ms) NOT NULL      -- 언제 부여됐나(감사 기초)
  PRIMARY KEY(user_id, role)                  -- 중복 부여 방지 + 인가 핫패스
  -- member 는 암묵 기본값(행 없음). role → authority 매핑은 src/core 코드 상수.
  -- superadmin 만 role:manage 를 가짐 → 상승 가드가 구조적.

games             치지직 카테고리 스냅샷 보드. (ADR-0015)
                  ※ 이 절은 ADR-0019 가 대체했다 — 현행 스키마는 그쪽을 본다.
                     아래는 v1 최초 설계의 기록이다(status 컬럼·epoch 날짜·category_id NOT NULL).
  id                integer PK
  category_id       text NOT NULL   UNIQUE     -- 치지직 categoryId. 한 카테고리 = 보드 1회
  category_type     text NOT NULL   CHECK(category_type = 'GAME')   -- 보드는 GAME 만
  category_value    text NOT NULL              -- 카테고리 이름(표시 스냅샷)
  poster_image_url  text                       -- 포스터 URL(스냅샷, nullable)
  status            text NOT NULL DEFAULT 'played'
                    CHECK(status IN ('playing','cleared','planned','played'))
  played_at         integer(ms)                -- 플레이한 날(관리자 입력·과거 가능·nullable)
  cleared_at        integer(ms)                -- 클리어한 날(nullable)
  created_at        integer(ms) NOT NULL       -- 레코드 생성(앱 자동)
  last_updated_at   integer(ms) NOT NULL       -- 레코드 수정(앱 자동)
  -- played_at/cleared_at 둘 다 null=예정, played_at만=플레이중/플레이함, cleared_at까지=클리어.
  -- ↑ 한 사실을 status 와 날짜에 두 번 적고 있었다. 그 중복이 ADR-0019 의 출발점이다.
```

세부 결정:

- **surrogate PK 전면.** 자연키(치지직 channelId)가 있어도 surrogate 를 쓴다 — 이식성·보안
  ·균일 조인. 자연키는 `oauth_accounts.provider_user_id` 로 내려가 UNIQUE 로 보장된다.
- **users ↔ oauth_accounts 분리** ([ADR-0006](./0006-chzzk-oauth-jwt-session.md) 보완). `channelId`
  는 `users` 가 아니라 `oauth_accounts.provider_user_id`. `users` 는 OAuth 무관하게 남고, 로그인
  수단이 늘어도 스키마가 안 바뀐다. 토큰은 저장하지 않는다.
- **users_roles = 부여 테이블** ([ADR-0012](./0012-role-based-writes-allowlist.md) 정교화). 단일
  `role` 스칼라 → M:N grant. `member` 는 암묵(행 없음), `admin`/`superadmin` 만 저장. role →
  authority(`game:write`·`game:delete`·`role:manage`) 매핑은 **`src/core` 코드 상수**(런타임 편집
  요구가 v1 에 없으므로 DB 테이블로 승격하지 않는다). superadmin 만 `role:manage` 를 가져
  **admin 은 다른 admin 을 임명·강등할 수 없다** — 상승 가드가 절차가 아니라 구조로 강제된다.
  ~~세션엔 role 대신 **effective authorities 집합**을 싣고,~~ 인가는 권한 단위로 검사한다.
  (**[ADR-0017](./0017-self-session-eddsa-refresh-rotation.md) 이 앞 절을 뒤집었다** — authorities 를
  세션에 실으면 역할 회수가 토큰 만료까지 지연된다. 세션은 신원만 싣고 authorities 는 **인가 순간
  DB 조회**(요청 스코프 메모이즈)로 얻는다. 권한 단위 검사라는 결정 자체는 그대로다.)
- **games = 치지직 카테고리 스냅샷** ([ADR-0015](./0015-chzzk-category-as-game-source.md)). freetext
  `name`·`genre`·`platform` 을 제거하고 category API 4필드를 denormalize. `status`·`played_at`
  ·`cleared_at` 은 우리 도메인(치지직이 주지 않는 플레이 상태·이력). 삭제는 **하드 삭제**
  (`deleted_at` 없음) — ~~되돌리기는 클라이언트 "지연 커밋"(타이머 만료 전엔 delete 뮤테이션을
  안 보냄)이라 서버에 삭제 상태를 영속시킬 필요가 없다.~~
  (**[ADR-0020](./0020-delete-confirm-dialog-replaces-undo-window.md) 이 뒷절을 뒤집었다** — 지연
  커밋·ghost·되돌리기는 카드마다 타이머·포커스 인계라는 상태 기계를 요구했고 얻는 건 "6초 안에
  마음 바꾸기" 하나였다. 실수 방어를 파괴 **전**의 **확인 다이얼로그**로 옮겨 상태를 안 남긴다.
  **하드 삭제라는 결정은 그대로**다 — 취소선 친 이 문장은 애초에 그 결론을 지지하던 근거가
  아니었다. 결론을 지는 건 아래 "소프트 삭제 기각"의 두 사유(v1 에 복구·감사 요구가 없다 /
  모든 조회가 필터를 영구히 지불한다)이고, 둘 다 이 변경과 무관하게 유효하다.)
- **타임스탬프.** SQLite/D1 엔 `offsetDateTime`/`timestamptz` 타입이 없다. 그래서 **instant 를
  epoch ms(정수)로 저장**하고 **KST 는 표시 경계에서 `Asia/Seoul` 포매터**로 보장한다(한국은
  DST 가 없어 고정 +9). `created_at`/`last_updated_at` 은 앱 사이드 자동 생성(`$defaultFn`
  /`$onUpdate`) — Worker 가 단일 진실원이라 "SQLite 기본값은 UTC" 함정을 피한다. `played_at`
  /`cleared_at` 은 관리자 입력값(뮤테이션 입력 → Zod 검증, 과거 가능·nullable)이라 자동 생성이
  아니다.
- **인덱스 = 무결성만 지금, 성능은 나중.** 초기 마이그레이션엔 데이터 정합성 제약(PK · UNIQUE
  · CHECK · FK)만 넣는다. 정렬·필터용 **성능 인덱스는 검색 feature 이슈로 미룬다** — v1 은
  100행 미만이라 인덱스 유무가 측정되지 않고, 정확한 인덱스는 그 feature 가 확정하는 쿼리
  조합(복합 인덱스 · keyword 를 LIKE 로 갈지 FTS5 로 갈지)에 딸려 나온다. 의도한 인덱스 목록은
  이슈에 적어 넘긴다. (인가 핫패스는 `users_roles` PK 와 `oauth_accounts` UNIQUE 로 이미
  커버돼 성능 인덱스를 미뤄도 로그인·권한 조회는 느려지지 않는다.)
- **시드 = 구조와 내용 분리.** 스키마는 마이그레이션(테스트 DB 포함 어디서나 적용), 시드 데이터
  (현재 보드 게임)는 **별도 seed 스크립트**(dev + 컷오버 prod 만, 테스트 DB 미적용)로 넣는다.
  테스트는 빈 스키마에 각자 픽스처를 넣어 결정성을 유지한다. seed 는 1회 실행이라 재배포로
  되살아나지 않는다.

## 근거

- **계약이 타입 정본**([ADR-0004](./0004-trpc-zod.md)): Drizzle 스키마 → 타입 → tRPC/Zod 로
  한 계약이 흐른다. CHECK 로 enum·스코프를 DB 에서도 보증한다.
- **YAGNI/JIT**([ADR-0010](./0010-verification-first-jit-abstraction.md)): roles/authorities DB 테이블
  ·소프트 삭제·성능 인덱스·프로필 필드는 실제 두 번째 요구가 seam 을 드러낼 때 붙인다. 지금은
  코드 상수·하드 삭제·제약만.
- **보안**: 외부 식별자(channelId)를 PK 로 노출하지 않고, 토큰을 저장하지 않으며, 상승 가드를
  구조로 강제한다.
- **이식성**: surrogate 정수 PK + epoch 정수 타임스탬프 + 표준 타입만 써서 다른 RDB(Postgres 등)
  로의 이전이 무손실에 가깝다.

## 기각한 대안

- **자연키(channelId) PK** — 이식성·보안·균일성에서 surrogate 에 밀린다. 자연키는 oauth 쪽
  UNIQUE 로 이미 보장된다.
- **단일 `role` 스칼라 컬럼**(0012 원안) — 다중 역할·권한 단위 인가·구조적 상승 가드를 못 준다.
- **roles·authorities DB 테이블 M:N** — 런타임 권한 편집 화면이 v1 에 없어, 코드 상수가 더
  값싸고 테스트로 못박히며 인가에 DB 왕복이 없다.
- **소프트 삭제(`deleted_at`)** — 복구 가능한 휴지통·삭제 감사 요구가 v1 에 없다. 드문 삭제를
  위해 모든 게임 조회에 `WHERE deleted_at IS NULL` 을 영구히 지우는 비용만 남는다.
- **성능 인덱스 선반영** — 이 규모에서 이득이 측정 불가하고, 검색 이슈가 실제 쿼리로 설계한다.
- **타임스탬프 TEXT ISO `+09:00`** — 원시 로우 가독성 하나뿐. 정수 대비 정렬·저장 비용이 크고
  오프셋 접미사 기본값이 bespoke SQLite 표현식이라 이식성이 되레 깎인다.
- **시드를 마이그레이션에 삽입** — 테스트 DB 에도 섞여 단위테스트가 비결정적이 된다.

## 결과

- (+) 스키마 → 타입 → tRPC/Zod 한 계약. 이식성·보안·검증성을 동시에.
- (+) 인가 상승 가드가 구조적 — 놓치기 쉬운 절차적 코드 가드 의존이 준다.
- (+) 공개 읽기·인가 핫패스가 무결성 제약(PK·UNIQUE)만으로도 인덱스가 서 있다.
- (−) `users.last_updated_at` 은 v1 에 갱신 계기가 없다(프로필 필드가 붙는 이슈에서 의미를
  얻는다). 지침이 명시적이라 컬럼은 둔다.
- (−) 성능 인덱스 부재 — 보드가 커지면 검색 이슈에서 추가해야 한다(의도 목록 문서화됨).
- (−) 역할 변경 감사 로그는 Phase 4 로 미룬다 — 사람 주도 역할 변경 뮤테이션이 생기는 그
  이슈에서 감사 테이블을 함께 설계한다(부트스트랩은 env 로부터 재구성 가능해 감사 불요).
