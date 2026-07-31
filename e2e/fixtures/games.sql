-- e2e 결정적 픽스처. 실제 chzzk 시드(원격 포스터)가 아니라 고정 게임을 로컬 D1 에 심어
-- 스모크·시각이 네트워크·데이터 변화에 흔들리지 않게 한다. poster 는 NULL 로 둬 이니셜 폴백을
-- 그려 요청 0(결정적). 매 실행 전 리셋 후 삽입.
--
-- 플레이 날짜의 정본은 이제 일정(schedule_entries)이다 — 보드는 그 항목의 MAX(scheduled_date)로
-- 플레이 날짜를 유도한다(이슈 #56). 그래서 "언제 플레이했나"는 games 컬럼이 아니라 아래 일정
-- 항목으로 심고, 유도된 값이 옛 played_at 과 글자 그대로 같게 둬 보드 정렬·시각 스냅샷이 안
-- 흔들리게 한다. 클리어는 게임 자체의 사실이라 games 에 남는다(cleared 플래그 + cleared_date).
-- created_at/last_updated_at 은 고정 epoch — id·정렬이 결정적이게.
--
-- 조합을 골고루 둔다: 플레이만 / 플레이+클리어 / 클리어만(일정 없음) / 아무것도 없음.
-- 마지막 둘이 "일정 없는 행은 뒤로" 정렬 규칙을 덮고, 아무것도 없음이 "칩 없음"을,
-- 클리어만(할로우 나이트, id 5)이 "일정은 없지만 클리어 칩은 뜬다"를 덮는다.
--
-- 그 할로우 나이트는 cleared_date 도 **NULL** 이다 — 클리어의 정본이 날짜가 아니라 플래그라는
-- 걸 덮는 유일한 행이다("깼는데 날짜 모름"). 한때 '2026-05-02' 였고 그때 이 행이 덮던 건
-- "cleared_date 가 있어도 카드 날짜 줄엔 안 실린다"였는데, 날짜가 통째로 상세로 내려가며 그
-- 계약 자체가 없어졌다. 날짜 있는 클리어는 셀레스테(7)가 계속 덮는다.
--
-- id 를 손으로 박는 게 시각 스냅샷의 전제다. 카드의 기울기·썸네일 패턴·각도를 game-board 가
-- String(id) 해시로 고르는데, id 는 autoIncrement 라 DELETE 로는 sqlite_sequence 가 안
-- 돌아간다 — 실행할 때마다 1..4 → 5..8 로 밀려 같은 게임이 매번 다른 패턴을 받았다.
-- 명시 id 는 시퀀스가 얼마든 그 값으로 들어가므로 해시 입력이 고정된다.
--
-- 삭제 순서는 FK 를 거스르지 않게 **자식부터**다. schedule_entries 는 game_id 로 games 를
-- 참조하므로(ON DELETE SET NULL) games 보다 먼저 비운다 — 안 그러면 옛 실행의 항목이 game_id
-- 만 NULL 로 풀린 채 남아 유도 날짜를 오염시킨다.
--
-- schedule_days 는 FK 가 없지만(하루의 속성일 뿐 무엇도 참조하지 않는다) 같이 비운다 —
-- 안 비우면 옛 실행이 남긴 시각·휴방이 새 실행의 주에 얹혀 화면이 달라진다(이슈 #117).
DELETE FROM schedule_entries;
DELETE FROM schedule_days;
DELETE FROM schedule_weeks;
DELETE FROM games;
INSERT INTO games
  (id, category_id, category_type, category_value, poster_image_url, cleared, cleared_date, created_at, last_updated_at)
VALUES
  (1, 'e2e-eldenring',        'GAME', '엘든 링',        NULL, 0, NULL,         1700000000000, 1700000000000),
  (2, 'e2e-minecraft',        'GAME', '마인크래프트',    NULL, 0, NULL,         1700000001000, 1700000001000),
  (3, 'e2e-littlenightmares', 'GAME', '리틀 나이트메어', NULL, 1, '2026-04-14', 1700000002000, 1700000002000),
  -- category_id NULL = 수동 입력 게임(치지직 검색에 없어 손으로 넣은 것).
  (4, NULL,                   'GAME', '직접 넣은 게임',  NULL, 0, NULL,         1700000003000, 1700000003000),
  -- 깼는데 플레이 일정도 클리어 날짜도 없는 게임("깼는데 날짜 모름"). 일정 항목이 없어 정렬상
  -- 뒤 그룹이고(lastPlayed null), 그 안에서는 created_at 내림차순이라 '직접 넣은 게임'보다
  -- 뒤에 선다. cleared 플래그만으로 칩이 뜬다 — 클리어의 정본이 날짜가 아니라는 증거다.
  (5, 'e2e-hollowknight',    'GAME', '할로우 나이트',   NULL, 1, NULL,         1700000002500, 1700000002500),
  -- 6~8 은 **행을 두 개로 만들려고** 있다. 기본 뷰포트(1280px)가 5열이라 5장짜리 픽스처는
  -- 한 행에 다 들어갔고, 그래서 이 보드의 핵심 계약인 **행 높이 균일화**(.games 의
  -- grid-auto-rows)가 시각 스냅샷에 한 번도 안 잡혔다. 6번은 이름이 일부러 길다: 2줄 클램프와
  -- 행 부풀림을 동시에 덮는 카드다.
  (6, 'e2e-longtitle',       'GAME', '레이튼 교수와 최후의 시간여행 모바일 HD 리마스터', NULL, 0, NULL, 1700000004000, 1700000004000),
  (7, 'e2e-celeste',         'GAME', '셀레스테',        NULL, 1, '2026-01-29', 1700000005000, 1700000005000),
  (8, 'e2e-stardew',         'GAME', '스타듀 밸리',     NULL, 0, NULL,         1700000006000, 1700000006000);

-- 플레이 일정. 유도 날짜(MAX(scheduled_date))가 옛 played_at 과 같도록 게임당 한 항목씩.
-- 할로우 나이트(5)·직접 넣은 게임(4)은 항목이 없어 "일정 없는 행은 뒤로"를 덮는다.
--
-- 시각은 여기 없다 — 하루의 속성으로 옮겼다(이슈 #117). 이 항목들은 0007 이 옛 played_at 에서
-- 이관한 레거시 아카이브를 흉내 내는 것이라 애초에 시각이 없었고(전부 NULL 이었다), 그래서
-- 아래 schedule_days 에도 대응 행을 안 만든다 — 행 없음 = 시각 미정·휴방 아님(schema.ts).
INSERT INTO schedule_entries
  (scheduled_date, title, game_id, created_at, last_updated_at)
VALUES
  ('2026-03-01', '엘든 링',        1, 1700000000000, 1700000000000),
  ('2026-07-12', '마인크래프트',    2, 1700000000000, 1700000000000),
  ('2026-04-11', '리틀 나이트메어', 3, 1700000000000, 1700000000000),
  ('2026-02-10', '레이튼 교수와 최후의 시간여행 모바일 HD 리마스터', 6, 1700000000000, 1700000000000),
  ('2026-01-20', '셀레스테',        7, 1700000000000, 1700000000000),
  ('2026-01-05', '스타듀 밸리',     8, 1700000000000, 1700000000000);

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
-- **주의: 이 블록은 로컬 개발 D1 의 로그인 신원도 지운다.** e2e 를 한 번 돌리면 dev 로 로그인해
-- 만들어 둔 계정과 부여받은 역할이 날아간다 — superadmin 은 다음 로그인 때 SUPERADMIN_CHANNEL_ID
-- 부트스트랩으로 되살아나지만 손으로 준 admin 은 안 돌아온다. 되살리려면 로그인을 다시 해
-- 신원을 만들고 superadmin 으로 역할을 다시 부여한다.
--
-- 삭제 순서는 FK 를 거스르지 않게 **자식부터**다. role_audit_logs 가 먼저인 게 핵심인데,
-- 이 테이블만 users.id 를 **cascade 없이** 참조하기 때문이다(refresh_tokens·security_events 는
-- onDelete: cascade 라 저절로 지워진다). append-only 감사 로그라 그렇게 설계된 것이고, 그래서
-- 로컬에서 역할 관리를 한 번이라도 써 본 개발자는 여기서 FOREIGN KEY constraint failed 로
-- **globalSetup 이 죽는다** — narrow-body 뿐 아니라 스모크·시각 전체가 시작조차 못 한다(실측).
-- 팬 제안은 게임과 작성자를 모두 참조한다. FK 가 꺼진 채 실행돼도 안전하도록 **부모보다 먼저**
-- 비운다 — 안 지우면 지난 실행의 제안이 남아 관리자 제안함 목록이 실행마다 달라진다.
DELETE FROM game_suggestions;
DELETE FROM role_audit_logs;
DELETE FROM users_roles;
DELETE FROM oauth_accounts;
DELETE FROM users;
INSERT INTO users (id, created_at, last_updated_at) VALUES (1, 1700000000000, 1700000000000);
INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, channel_name, created_at, last_updated_at)
VALUES (1, 1, 'chzzk', 'e2e-channel-0000', '챠이로 쿠냐', 1700000000000, 1700000000000);
INSERT INTO users_roles (user_id, role, created_at) VALUES (1, 'admin', 1700000000000);

-- 역할 없는 팬(user 2). **users_roles 행이 없는 게 이 신원의 전부다** — 그게 곧 member 이고
-- 권한은 빈 집합이다(core/authorities: 상승 역할만 저장한다).
--
-- 이 행이 필요한 이유는 팬 제안(ADR-0025)이 로그인만 요구하기 때문이다. admin 신원으로 재면
-- "권한 없이도 제안이 되는가"를 못 본다 — 그건 이 기능의 핵심 계약이라 반드시 빈 권한으로
-- 확인해야 한다. provider_user_id 는 e2e/suggestions.spec.ts 의 FAN.channelId 와 글자 그대로
-- 같아야 인가 조회(channelId → user_id)가 이어진다(위 admin 블록과 같은 이유).
INSERT INTO users (id, created_at, last_updated_at) VALUES (2, 1700000010000, 1700000010000);
INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, channel_name, created_at, last_updated_at)
VALUES (2, 2, 'chzzk', 'e2e-channel-fan0', '쿠냐팬', 1700000010000, 1700000010000);

-- ── 긴 공지가 있는 **발행된** 주 둘(2026-08-01, 적대적 리뷰 지적) ──────────────────
-- 편집기의 공지 입력을 걷으면서(#56 결정 35 짝) 화면에서 500자 공지를 만들 길이 사라졌다.
-- 그런데 **앱은 여전히 기존 공지를 보존하고 카드에 그린다** — 긴 공지가 일정 목록을 눌러
-- 항목이 잘리던 회귀(GitHub codex 리뷰 P2: 팬아트 모양은 200자에서 이미 잘리고 500자면 목록
-- 높이가 0 이 됐다)가 그대로 무방비가 된다. 그 조건을 UI 밖에서 심어 되살린다.
--
-- **주를 둘 심는 이유**: 이 저장소는 D1 픽스처 하나를 모든 스펙이 공유하므로(AGENTS), 한 주를
-- 두 스펙이 쓰면 팬아트를 올리는 쪽이 안 올리는 쪽의 카드 모양을 바꿔 버린다. 그래서 카드 모양
-- 두 가지를 주 하나씩 맡는다 — 2030-06-03 은 팬아트 없는 세로 7열, 2030-07-01 은 팬아트
-- 테스트가 그 위에 그림을 올려 가로 모양을 만든다(그 스펙이 저장해도 공지는 baseline 에서
-- 그대로 실려 나간다 — 폼이 note 를 안 건드리므로).
--
-- 공지 500자는 `zeroblob` 트릭으로 만든다: 500바이트 → hex 는 '00' 1000자 → 치환하면 정확히
-- 500자다. 손으로 적으면 이 파일이 읽히지 않고 길이도 눈으로 못 센다(저장 상한이 곧 이 값이라
-- 한 글자라도 어긋나면 재는 대상이 달라진다).
INSERT INTO schedule_weeks
  (week_start_date, note, draft, published_at, created_at, last_updated_at)
VALUES
  ('2030-06-03', replace(hex(zeroblob(500)), '00', '공'), 0, 1700000020000, 1700000020000, 1700000020000),
  ('2030-07-01', replace(hex(zeroblob(500)), '00', '공'), 0, 1700000020000, 1700000020000, 1700000020000);

-- 두 주에 항목을 하나씩 둔다 — 목록이 눌렸는지 보려면 잘릴 항목이 있어야 한다. game_id 는
-- NULL 이다(표지 없는 자유 편성): 게임을 이으면 보드의 MAX(scheduled_date) 유도가 흔들려
-- games 스펙이 조용히 깨진다.
INSERT INTO schedule_entries
  (scheduled_date, title, game_id, created_at, last_updated_at)
VALUES
  ('2030-06-03', '긴 공지 아래 항목', NULL, 1700000020000, 1700000020000),
  ('2030-07-01', '긴 공지 아래 항목', NULL, 1700000020000, 1700000020000);
