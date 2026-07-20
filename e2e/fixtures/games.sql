-- e2e 결정적 픽스처. 실제 chzzk 시드(원격 포스터)가 아니라 고정 게임을 로컬 D1 에 심어
-- 스모크·시각이 네트워크·데이터 변화에 흔들리지 않게 한다. poster 는 NULL 로 둬 이니셜 폴백을
-- 그려 요청 0(결정적). 매 실행 전 리셋 후 삽입.
-- created_at/last_updated_at 은 고정 epoch, played_at 도 고정 날짜 — 정렬이 결정적이게.
--
-- 날짜 조합을 골고루 둔다: 플레이만 / 플레이+클리어 / 클리어만 / 날짜 없음. 마지막 둘이
-- "played_at 이 null 인 행은 뒤로" 정렬 규칙을 덮고, 날짜 없음이 "날짜 줄 자체를 렌더하지
-- 않음"을, 클리어만이 그 반대 분기(플레이한 날 대신 클리어한 날을 싣고 칩은 접는다)를 덮는다.
-- 클리어만 있는 행은 카드 렌더에 전용 분기가 있는데(game-board::dateLabel) e2e 가 한 번도
-- 실행하지 않던 조합이었다.
--
-- id 를 손으로 박는 게 시각 스냅샷의 전제다. 카드의 기울기·썸네일 패턴·각도를 game-board 가
-- String(id) 해시로 고르는데, id 는 autoIncrement 라 DELETE 로는 sqlite_sequence 가 안
-- 돌아간다 — 실행할 때마다 1..4 → 5..8 → 9..12 로 밀려 같은 게임이 매번 다른 패턴을 받았다.
-- 실측: 베이스라인을 새로 뽑은 직후 재실행에도 games 두 장이 10.30% 차이로 실패했다.
-- 명시 id 는 시퀀스가 얼마든 그 값으로 들어가므로 해시 입력이 고정된다.
DELETE FROM games;
INSERT INTO games
  (id, category_id, category_type, category_value, poster_image_url, played_at, cleared_at, created_at, last_updated_at)
VALUES
  (1, 'e2e-eldenring',        'GAME', '엘든 링',        NULL, '2026-03-01', NULL,         1700000000000, 1700000000000),
  (2, 'e2e-minecraft',        'GAME', '마인크래프트',    NULL, '2026-07-12', NULL,         1700000001000, 1700000001000),
  (3, 'e2e-littlenightmares', 'GAME', '리틀 나이트메어', NULL, '2026-04-11', '2026-04-14', 1700000002000, 1700000002000),
  -- category_id NULL = 수동 입력 게임(치지직 검색에 없어 손으로 넣은 것).
  (4, NULL,                   'GAME', '직접 넣은 게임',  NULL, NULL,         NULL,         1700000003000, 1700000003000),
  -- 플레이한 날은 모르고 클리어만 아는 행. played_at 이 null 이라 정렬상 뒤 그룹이고,
  -- 그 안에서는 created_at 내림차순이라 '직접 넣은 게임'보다 뒤에 선다.
  (5, 'e2e-hollowknight',    'GAME', '할로우 나이트',   NULL, NULL,         '2026-05-02', 1700000002500, 1700000002500),
  -- 6~8 은 **행을 두 개로 만들려고** 있다. 기본 뷰포트(1280px)가 5열이라 5장짜리 픽스처는
  -- 한 행에 다 들어갔고, 그래서 이 보드의 핵심 계약인 **행 높이 균일화**(.games 의
  -- grid-auto-rows)가 시각 스냅샷에 한 번도 안 잡혔다 — 그걸 고친 PR 자신이 회귀 게이트를
  -- 못 가진 상태였다. 두 행이 되면 "긴 이름이 그 행만 부풀리는가"가 스냅샷 차이로 드러난다.
  -- 그래서 6번은 이름이 일부러 길다: 2줄 클램프와 행 부풀림을 동시에 덮는 카드다.
  (6, 'e2e-longtitle',       'GAME', '레이튼 교수와 최후의 시간여행 모바일 HD 리마스터', NULL, '2026-02-10', NULL, 1700000004000, 1700000004000),
  (7, 'e2e-celeste',         'GAME', '셀레스테',        NULL, '2026-01-20', '2026-01-29', 1700000005000, 1700000005000),
  (8, 'e2e-stardew',         'GAME', '스타듀 밸리',     NULL, '2026-01-05', NULL,         1700000006000, 1700000006000);

-- 쓰기 권한자 1명. access 는 무상태라 세션만으론 DB 를 안 보지만, 인가는 **매번 역할을
-- 조회**하므로(ADR-0017) 이 행들이 없으면 로그인해도 authorities 가 비어 member 로 떨어진다.
--
-- 세 행이 다 필요한 건 조회가 **userId 가 아니라 channelId 로** 들어오기 때문이다
-- (server-session.authoritiesForActor → listRolesForChannel). access 클레임엔 userId 도
-- 있지만 인가 경로는 그걸 안 쓰므로, oauth_accounts 가 channelId → user_id 를 이어 주지
-- 않으면 users_roles 에 행이 있어도 안 걸린다. provider_user_id 는 e2e/session.ts 의
-- E2E_USER.channelId 와 글자 그대로 같아야 한다.
--
-- 이게 있어야 하는 이유: 로그아웃 상태의 `/games` 본문에는 **인터랙티브 요소가 하나도 없다**.
-- 추가·수정·삭제가 전부 canWrite/canDelete 뒤라, 권한 없이 좁은 폭을 재면 이 페이지에서
-- 터치 타깃 검사가 0건이 된다 — 검사한 척만 하는 초록이다(narrow-body.spec.ts).
-- superadmin 이 아니라 admin 인 건 game:write·game:delete 만 필요하고 role:manage 는
-- 이 스펙의 관심사가 아니어서다 — 픽스처가 필요 이상의 권한을 들고 있지 않게 한다.
--
-- **주의: 이 블록은 로컬 개발 D1 의 로그인 신원도 지운다.** 전엔 games 만 지웠다. e2e 를 한 번
-- 돌리면 dev 로 로그인해 만들어 둔 계정과 부여받은 역할이 날아간다 — superadmin 은 다음 로그인
-- 때 SUPERADMIN_CHANNEL_ID 부트스트랩으로 되살아나지만 손으로 준 admin 은 안 돌아온다.
-- 되살리려면 로그인을 다시 해 신원을 만들고 superadmin 으로 역할을 다시 부여한다.
--
-- 삭제 순서는 FK 를 거스르지 않게 **자식부터**다. role_audit_logs 가 먼저인 게 핵심인데,
-- 이 테이블만 users.id 를 **cascade 없이** 참조하기 때문이다(refresh_tokens·security_events 는
-- onDelete: cascade 라 저절로 지워진다). append-only 감사 로그라 그렇게 설계된 것이고, 그래서
-- 로컬에서 역할 관리를 한 번이라도 써 본 개발자는 여기서 FOREIGN KEY constraint failed 로
-- **globalSetup 이 죽는다** — narrow-body 뿐 아니라 스모크·시각 전체가 시작조차 못 한다(실측).
DELETE FROM role_audit_logs;
DELETE FROM users_roles;
DELETE FROM oauth_accounts;
DELETE FROM users;
INSERT INTO users (id, created_at, last_updated_at) VALUES (1, 1700000000000, 1700000000000);
INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, channel_name, created_at, last_updated_at)
VALUES (1, 1, 'chzzk', 'e2e-channel-0000', '챠이로 쿠냐', 1700000000000, 1700000000000);
INSERT INTO users_roles (user_id, role, created_at) VALUES (1, 'admin', 1700000000000);
