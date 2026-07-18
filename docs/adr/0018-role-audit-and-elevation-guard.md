# ADR-0018: 역할 변경 감사 로그 + 구조적 상승 가드 (관리 UI 없음)

- 상태: Accepted
- 날짜: 2026-07-18
- 보완: [ADR-0012](./0012-role-based-writes-allowlist.md)(역할 기반 쓰기)·[ADR-0014](./0014-v1-data-model-schema.md)(감사 테이블 연기)의 실현

## 맥락

[ADR-0012](./0012-role-based-writes-allowlist.md)는 "권한 상승 가드 + 감사 로그"를 요구했고,
[ADR-0014](./0014-v1-data-model-schema.md)는 감사 로그 테이블을 **사람 주도 역할 변경 뮤테이션이
생기는 Phase 4 로 명시적으로 연기**했다(부트스트랩은 `SUPERADMIN_CHANNEL_ID` 로부터 재구성 가능해
감사 불요). Phase 4(#6)가 그 뮤테이션을 만들면서 감사·상승 가드를 함께 설계한다.

역할 시스템의 흔한 세 구멍을 닫아야 한다: (1) 권한 없는 자의 역할 변경, (2) 자기 승격·마지막
superadmin 의 자기 강등(락아웃), (3) superadmin 을 API 로 증식·제거.

## 결정

- **감사 테이블 `role_audit_logs`**(append-only): `actor_user_id`·`target_user_id`(FK users)·
  `action`(grant|revoke)·`role`·`created_at`(epoch ms). 사람 주도 역할 변경을 남긴다 — 부트스트랩은
  env 재구성 가능해 기록하지 않는다. surrogate PK·CHECK 겹침은 다른 테이블과 같은 컨벤션
  ([ADR-0014](./0014-v1-data-model-schema.md)). 수정·삭제가 없어 `last_updated_at` 이 없다.
- **상승 가드는 두 겹**: (1) `authorizedProcedure("role:manage")` — `role:manage` 는 superadmin 만
  가지므로([ADR-0014](./0014-v1-data-model-schema.md)) admin 은 여기서 이미 막힌다. (2) 순수 규칙
  `src/core/roles.ts` `authorizeRoleChange` — self-target(자기 자신)·`superadmin` 역할 부여/회수를
  거절한다. 규칙을 코드 상수로 못박아 테스트가 각 거절을 지킨다.
- **superadmin 은 API 로 부여·회수하지 않는다** — 오직 `SUPERADMIN_CHANNEL_ID` 부트스트랩으로만
  존재한다. API 를 열면 superadmin 증식·마지막 superadmin 제거가 가능해진다.
- **관리 UI 는 만들지 않는다**(사용자 확정) — 서버 뮤테이션(`role.grant`/`role.revoke`)만 둔다. v1 은
  admin 임명이 드물어 뮤테이션 직접 호출로 충분하고, UI 는 리뷰 표면만 넓힌다([ADR-0010](./0010-verification-first-jit-abstraction.md)
  YAGNI). 필요해지면 뮤테이션 위에 붙인다.

## 근거

- 상승 가드를 절차가 아니라 **구조**로 만든다: `role:manage` 를 superadmin 만 갖는 매핑 + self·superadmin
  거절 규칙이 "자기 승격" 구멍을 처음부터 막는다([ADR-0012](./0012-role-based-writes-allowlist.md) 정신).
- 서버가 인가의 정본이다(불변식 3) — UI 유무와 무관하게 뮤테이션이 방어선이라, UI 를 미뤄도 보안이 안 샌다.
- 감사를 뮤테이션과 같은 요청에서 쓴다 — 역할이 바뀌면 반드시 흔적이 남는다.

## 기각한 대안

- **감사 없이 역할만 변경** — "누가 누구를 언제 승격했나"를 잃는다. 공용 보드의 쓰기 권한이라 흔적이 필요.
- **role 스칼라 + 절차적 가드** — [ADR-0014](./0014-v1-data-model-schema.md)에서 이미 M:N grant + authority
  매핑으로 옮겼다. 상승 가드가 매핑에서 구조적으로 흐른다.
- **관리 UI 를 v1 에 포함** — 리뷰 표면·유지보수만 늘고 admin 임명 빈도가 낮아 값을 못 한다. 서버
  뮤테이션이 정본이라 UI 는 나중에 얹으면 된다.

## 결과

- (+) 역할 변경이 서버 권위 + 감사로 남고, 상승 가드가 매핑·순수 규칙 두 겹으로 구조화된다.
- (+) 각 거절 경로(권한 없음·self·superadmin·미등록 사용자)가 caller 단위테스트로 못박힌다.
- (−) admin 임명이 UI 없이 뮤테이션 직접 호출이라 손이 간다 — v1 의 드문 작업이라 감수한다.
- (−) `role_audit_logs` 는 조회 화면이 아직 없다 — 필요 시 관리 화면 이슈에서 읽기를 붙인다.
