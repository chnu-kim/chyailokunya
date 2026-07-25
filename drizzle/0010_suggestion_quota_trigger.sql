-- 손으로 쓴 마이그레이션(drizzle-kit 생성물이 아니다). drizzle 스키마 DSL 엔 트리거가 없어
-- db:generate 로는 만들 수 없고, 그래서 이 파일과 meta/_journal.json 항목을 직접 더했다.
-- **스냅샷(meta/0010_snapshot.json)은 0009 것과 같다** — 트리거는 drizzle 이 추적하는 대상이
-- 아니라 테이블 정의가 하나도 안 바뀌기 때문이다.
--
-- 왜 필요한가: 팬 제안은 로그인만 하면 쓸 수 있어(ADR-0025 결정 1) 도배 상한이 유일한 방어인데,
-- 앱 쪽 검사는 count → insert 두 왕복이라 **동시 요청 앞에서 통째로 뚫린다.** 각 요청이 같은
-- 낮은 수를 읽고 전부 통과하므로, 한 번에 100개를 쏘면 100개가 다 들어간다(적대적 리뷰가 잡았다 —
-- "한두 건"이라던 애초 주석이 틀렸다). 추가 요청은 대상이 없어 게임당 UNIQUE 도 안 걸리므로
-- 그 경로가 특히 열려 있다. D1 엔 대화형 트랜잭션이 없어 조건부 INSERT 를 못 만드는 대신,
-- **판정을 INSERT 자체에 붙이면** 원자성이 SQLite 쪽에서 성립한다.
--
-- 상한 20 은 features/suggestions/service.ts 의 OPEN_SUGGESTION_LIMIT 와 **같은 값이어야 한다.**
-- 두 곳에 사는 이유는 역할이 다르기 때문이다: 앱 쪽은 친절한 문구를 내려고 미리 세고, 여기는
-- 경합에서도 무너지지 않는 진짜 방어선이다(users_roles 의 CHECK 가 core ROLES 를 리터럴로
-- 박는 것과 같은 구조 — DB 제약은 SQL 로만 표현된다). 한쪽만 고치면 앱이 20에서 막는데 DB 는
-- 다른 수에서 막아 사용자가 못 알아들을 오류를 본다.
CREATE TRIGGER game_suggestions_open_quota
BEFORE INSERT ON game_suggestions
WHEN (
  SELECT count(*) FROM game_suggestions
  WHERE author_user_id = NEW.author_user_id AND status = 'pending'
) >= 20
BEGIN
  SELECT RAISE(ABORT, 'too many pending suggestions');
END;
