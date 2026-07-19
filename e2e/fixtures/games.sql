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
  (5, 'e2e-hollowknight',    'GAME', '할로우 나이트',   NULL, NULL,         '2026-05-02', 1700000002500, 1700000002500);
