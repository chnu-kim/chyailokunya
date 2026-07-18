-- e2e 결정적 픽스처. 실제 chzzk 시드(원격 포스터)가 아니라 고정 게임을 로컬 D1 에 심어
-- 스모크·시각이 네트워크·데이터 변화에 흔들리지 않게 한다. poster 는 NULL 로 둬 이니셜 폴백을
-- 그려 요청 0(결정적). 상태를 골고루 둬 필터 스모크가 의미 있게 한다. 매 실행 전 리셋 후 삽입.
-- created_at/last_updated_at 은 고정 epoch — 정렬(최신 위) 도 결정적이게.
DELETE FROM games;
INSERT INTO games
  (category_id, category_type, category_value, poster_image_url, status, created_at, last_updated_at)
VALUES
  ('e2e-eldenring',        'GAME', '엘든 링',        NULL, 'played',  1700000000000, 1700000000000),
  ('e2e-minecraft',        'GAME', '마인크래프트',    NULL, 'playing', 1700000001000, 1700000001000),
  ('e2e-littlenightmares', 'GAME', '리틀 나이트메어', NULL, 'cleared', 1700000002000, 1700000002000),
  ('e2e-planned',          'GAME', '예정작 하나',     NULL, 'planned', 1700000003000, 1700000003000);
