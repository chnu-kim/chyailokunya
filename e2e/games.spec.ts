import { expect, test } from "@playwright/test";
import { expectSignedIn, signIn } from "./session";

/* 게임 보드는 D1 에서 서버가 읽어 렌더한다(Phase 3). 데이터는 globalSetup 이 심은 결정적
   픽스처 8장(날짜 조합 골고루, poster null, 기본 뷰포트 5열이라 두 행). 추가·수정·삭제 UI 는 쓰기 권한이 있어야 뜨므로
   여기선 읽기만 스모크한다 — 쓰기의 "서버 권위"는 tRPC 단위테스트가 증명한다(이슈 #5).

   상태 필터 스모크가 여기 있었다. status 컬럼과 함께 UI 에서 사라졌고, 그 자리를 날짜 표시
   검증이 대신한다 — 필터가 덮던 "행마다 다른 상태"를 이제 날짜 조합이 표현한다. */

const CARDS = ".game";

// 카드를 눌러 상세를 연다. 카드 안의 유일한 버튼이 곧 카드 전체의 히트 영역이다(games.css).
function openCard(page: import("@playwright/test").Page, name: string) {
  return page.locator(CARDS).filter({ hasText: name }).getByRole("button").click();
}

test("게임: D1 에서 읽어 렌더 · 카드 앞면은 이름과 클리어까지", async ({ page }) => {
  await page.goto("/games");

  await expect(page.getByRole("heading", { level: 1, name: "플레이한 게임" })).toBeVisible();
  // 서버가 D1 에서 읽어온 픽스처 8장. 5열 뷰포트라 두 행이 되고, 그래야 시각 스냅샷이
  // 행 높이 균일화(.games 의 grid-auto-rows)를 실제로 본다 — 한 행이면 그 축이 안 잡힌다.
  await expect(page.locator(CARDS)).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "엘든 링" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "마인크래프트" })).toBeVisible();

  /* **날짜는 앞면에 없다.** 격자는 표지·이름·클리어까지만 싣고 나머지는 카드를 눌러야 나온다
     (game-board 주석). 날짜 텍스트가 다시 새어 나오면 여기가 빨개진다. */
  const elden = page.locator(CARDS).filter({ hasText: "엘든 링" });
  await expect(elden).not.toContainText("2026.03.01");
  await expect(elden.getByText("클리어")).toHaveCount(0);

  // 클리어는 칩으로 앞면에 남는다 — 훑는 눈이 던지는 질문이라 카드마다 열어 보게 하면 안 된다.
  const little = page.locator(CARDS).filter({ hasText: "리틀 나이트메어" });
  await expect(little).not.toContainText("2026.04.11");
  await expect(little.getByText("클리어")).toBeVisible();

  /* 플레이 일정도 클리어 날짜도 없이 **플래그만** 있는 행. 칩이 뜨는 건 클리어의 정본이
     날짜가 아니라 플래그라서다 — 날짜 유무로 판정하면 이 카드의 칩이 사라진다. */
  const hollow = page.locator(CARDS).filter({ hasText: "할로우 나이트" });
  await expect(hollow.getByText("클리어")).toBeVisible();

  // 날짜 있는 클리어도 앞면엔 날짜를 안 싣는다 — 칩만 같은 모양으로 선다.
  const celeste = page.locator(CARDS).filter({ hasText: "셀레스테" });
  await expect(celeste.getByText("클리어")).toBeVisible();
  await expect(celeste).not.toContainText("2026.01.29");

  // 안 깬 게임은 칩 줄 자체를 렌더하지 않는다 — 빈 상자로 높이를 맞추면 있는 척 읽힌다.
  const manual = page.locator(CARDS).filter({ hasText: "직접 넣은 게임" });
  await expect(manual).toBeVisible();
  await expect(manual.locator('[data-od-id^="game-meta-"]')).toHaveCount(0);

  // 정렬: 유도된 플레이 날짜(lastPlayed = MAX(scheduled_date)) 내림차순, 일정이 없어 null 인
  // 행은 뒤 그룹에서 created_at 내림차순. 할로우 나이트는 클리어한 날이 있어도 일정 항목이 없어
  // (lastPlayed null) 뒤 그룹이다 — 클리어 날짜는 정렬 축이 아니라는 규칙이 여기서 한 번 실행된다.
  await expect(page.locator(CARDS + " .game__name")).toHaveText([
    "마인크래프트",
    "리틀 나이트메어",
    "엘든 링",
    "레이튼 교수와 최후의 시간여행 모바일 HD 리마스터",
    "셀레스테",
    "스타듀 밸리",
    "직접 넣은 게임",
    "할로우 나이트",
  ]);
});

/* 앞면에서 뺀 정보가 **어디로 갔는지**를 못박는다. 이게 없으면 "카드에 날짜가 없다"만 남아,
   날짜를 통째로 잃어버린 회귀도 초록으로 통과한다.

   **로그아웃 상태로 연다.** 상세는 권한 뒤에 있지 않다 — 담긴 날짜는 공개 목록이 이미 실어
   보낸 값이고, 앞면에서 뺀 것을 권한 뒤로 숨기면 로그아웃 방문자는 전에 보이던 날짜를 잃는다.
   권한이 가르는 건 조작(수정·삭제)뿐이고 그 분기는 아래 단언이 함께 본다. */
test("게임: 카드를 열면 날짜·클리어가 상세에 뜬다(로그아웃도)", async ({ page }) => {
  await page.goto("/games");

  await openCard(page, "엘든 링");
  const detail = page.locator('dialog[data-od-id="game-detail"]');
  await expect(detail).toBeVisible();
  await expect(detail.locator('[data-od-id="detail-played"]')).toHaveText("2026.03.01");
  await expect(detail.locator('[data-od-id="detail-cleared"]')).toHaveText("미완료");
  // 조작은 권한 뒤다 — 로그아웃 상태에선 수정·삭제가 아예 없다(서버 인가와 이중, 불변식 3).
  await expect(detail.locator('[data-od-id^="game-edit-"]')).toHaveCount(0);
  await expect(detail.locator('[data-od-id^="game-del-"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  /* 클리어한 날은 **상세에만** 뜬다. 정렬 축이 아닌 날짜를 앞면에 실으면 순서가 어긋나 보이므로
     보드에선 뺐는데(위 스펙), 그렇다고 값이 사라진 건 아니라는 걸 여기가 증명한다. */
  await openCard(page, "셀레스테");
  await expect(detail.locator('[data-od-id="detail-cleared"]')).toHaveText("2026.01.29 클리어");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  /* 깼는데 날짜를 모르는 상태도 글자로 말한다 — 빈칸으로 두면 안 깬 것과 구별이 안 되고,
     그 구별이 클리어를 날짜와 독립된 플래그로 둔 이유 그 자체다. "완료"(날짜 모름)와 위의
     "2026.01.29 클리어"가 **다른 글자여야** 그 구별이 산다. 일정 항목도 없는 행이라
     "기록 없음"까지 한 화면에서 함께 본다. */
  await openCard(page, "할로우 나이트");
  await expect(detail.locator('[data-od-id="detail-cleared"]')).toHaveText("완료");
  await expect(detail.locator('[data-od-id="detail-played"]')).toHaveText("기록 없음");
});

/* 상세는 히스토리 엔트리 하나를 차지한다(이슈 #65). 안 그러면 모바일 하드웨어 뒤로가기·iOS
   스와이프가 모달이 아니라 **페이지를 통째로 떠난다** — 사용자가 실제로 겪은 결함이고, 이
   배선은 브라우저 히스토리에 걸려 있어 단위 테스트로는 재현이 안 된다.

   `/` 를 먼저 들르는 이유: 떠날 곳이 있어야 "떠났다"가 관찰된다. 히스토리에 /games 하나뿐이면
   뒤로가기가 아무 데도 안 가서, 배선이 통째로 없어도 이 스펙이 초록으로 통과한다. */
test("게임: 뒤로가기는 페이지가 아니라 상세를 닫는다 · 직접 닫으면 엔트리가 안 남는다", async ({
  page,
}) => {
  await page.goto("/");
  await page.goto("/games");

  await openCard(page, "엘든 링");
  const detail = page.locator('dialog[data-od-id="game-detail"]');
  await expect(detail).toBeVisible();
  /* **주소는 안 바뀐다.** 딥링크를 안 열기로 한 결정이라(#65) /games/1 같은 주소가 생기면
     거짓말이 된다 — 그 주소를 새로고침해도 상세가 없다. */
  await expect(page).toHaveURL(/\/games$/);

  // 뒤로가기 한 번: 모달만 닫히고 보드는 그대로다.
  await page.goBack();
  await expect(detail).toHaveCount(0);
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole("heading", { level: 1, name: "플레이한 게임" })).toBeVisible();
  /* 포커스가 누른 카드로 돌아온다. 뒤로가기로 닫을 때 상세를 곧장 언마운트하면 dialog 가
     열린 채 DOM 에서 빠져 포커스가 body 로 떨어진다 — 키보드 사용자가 탭 순서 맨 앞으로
     튕기고, 그 회귀는 화면상 아무 표시도 안 난다. 닫기 신호를 태워 브라우저의 dialog 닫기
     알고리즘을 거치게 한 이유가 이것이다(game-board 의 detailClosing). */
  await expect(page.locator('[data-od-id="game-open-1"]')).toBeFocused();

  /* 반대 방향: 사용자가 **직접** 닫았으면 쌓아 둔 엔트리를 되돌려야 한다. 안 되돌리면 빈
     엔트리가 남아 그다음 뒤로가기가 아무 일도 안 한 것처럼 보인다 — 여기선 `/` 로 못 나가는
     모습으로 드러난다. */
  await openCard(page, "엘든 링");
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

/* 겹친 모달이 떠 있는 동안의 뒤로가기. **아무것도 안 닫고 엔트리만 다시 쌓는 게 결정이다** —
   상세만 닫으면 위 모달이 돌아갈 자리를 잃고, 위까지 닫으면 뒤로가기 한 번이 셸의 잠금
   둘(미저장 확인·쓰기 중 잠금)을 통째로 우회한다(game-board 의 popstate 주석).

   **읽기 전용이다**: 폼을 열어 보기만 하고 저장을 안 누른다 — 공유 픽스처를 안 흔든다. */
test("관리자: 수정이 겹쳐 뜬 동안엔 뒤로가기가 페이지를 안 떠난다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);
  await page.goto("/games");
  await expectSignedIn(page);

  await openCard(page, "리틀 나이트메어");
  const detail = page.locator('dialog[data-od-id="game-detail"]');
  await page.locator('[data-od-id="game-edit-3"]').click();
  const editor = page.locator('dialog[data-od-id="game-editor"]');
  // 조회가 끝나기 전에 뒤로가기를 던지면 무엇이 열려 있는지가 흐려진다 — 뜬 걸 보고 시작한다.
  await expect(page.locator('[data-od-id="editor-played"]')).toHaveValue("2026-04-11");

  await page.goBack();
  // 세 가지가 전부 그대로다: 페이지 · 아래 상세 · 위 수정 폼.
  await expect(page).toHaveURL(/\/games$/);
  await expect(detail).toBeVisible();
  await expect(editor).toBeVisible();

  /* 덫이 아니라 유예다 — 위를 닫으면 그다음 뒤로가기가 정상으로 돈다. 이 단언이 없으면
     "뒤로가기를 영영 삼킨다"는 회귀가 위 단언만으로는 초록이다. */
  await page.locator('[data-od-id="game-editor-cancel"]').click();
  await expect(editor).toHaveCount(0);
  await page.goBack();
  await expect(detail).toHaveCount(0);
  await expect(page).toHaveURL(/\/games$/);
});

/* 여러 날 편성 게임의 저장. **서버 단위 테스트로는 못 잡는 자리다** — 계약("playedDate 를 안
   실으면 일정을 안 건드린다")은 라우터 테스트가 덮지만, 폼이 그 계약을 지키는지는 실제 제출
   페이로드를 태워야 안다. 초판이 정확히 거기서 깨졌다: 잠긴 폼이 빈 문자열을 실었고 그게 null
   로 접혀 "여러 날을 지우려 한다"로 거절돼 **저장이 통째로 막혔다**(codex 리뷰).

   ── 공유 픽스처를 **관찰 가능하게 바꾸지 않는다** ────────────────────────────────
   playwright 는 fullyParallel 이라 이 스펙이 읽기 전용 스펙과 동시에 돈다. 그래서 그쪽이 보는
   상태를 건드리면 타이밍에 따라 빨개진다(리뷰가 잡은 flakiness). 두 가지로 피한다:

   1. **클리어를 안 켠다.** 위 읽기 스펙이 "엘든 링엔 클리어 칩이 없다"를 못박는다. 회귀는
      "저장이 거절됐다"였으므로 값을 안 바꾼 저장이 통과하는지만 봐도 똑같이 잡힌다.
   2. **기존 항목보다 이른 날짜에 붙인다.** 보드 날짜·정렬은 MAX(scheduled_date)라, 2026-03-01
      보다 이른 날을 더하면 카드의 "2026.03.01 플레이"도 정렬 위치도 그대로다. 주(2026-02-16)는
      다른 스펙이 쓰지 않는다 — 한때 픽스처와 같은 주에 붙였다가 schedule.spec 의 레거시 주
      스펙을 깼다(그쪽 `.first()` 를 날짜순으로 앞선 내 항목이 가로챘다). */
test("관리자: 여러 날 편성 게임도 저장이 통과한다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);

  await page.goto("/schedule?week=2026-02-16");
  await expectSignedIn(page);
  await page.locator('[data-od-id="schedule-day-add-2026-02-17"]').click();
  const day = page.locator('[data-od-id="schedule-day-2026-02-17"]');
  await day.locator('[data-od-id^="schedule-entry-title-"]').fill("엘든 링 1일차");
  await day.locator('[data-od-id^="schedule-entry-game-"]').selectOption({ label: "엘든 링" });
  const save = page.locator('[data-od-id="schedule-save"]');
  await save.click();
  await expect(save).toHaveText("저장됨");

  // 이제 게임 폼은 날짜를 잠근다 — 입력이 사라지고 날짜 나열만 남는다.
  // 수정은 카드 상세를 거쳐 연다(격자에서 내려왔다 — game-board 주석).
  await page.goto("/games");
  await openCard(page, "엘든 링");
  await page.locator('[data-od-id="game-edit-1"]').click();
  await expect(page.locator('[data-od-id="editor-locked"]')).toBeVisible();
  await expect(page.locator('[data-od-id="editor-played"]')).toHaveCount(0);

  // 아무것도 안 바꾸고 저장만 누른다 — 옛 코드에선 이것도 BAD_REQUEST 로 막혔다.
  await page.locator('[data-od-id="game-editor-submit"]').click();

  /* 저장이 성공하면 모달이 닫힌다. 실패하면 오류 문구를 띄운 채 열려 있다 — 그게 회귀의 모습이다. */
  await expect(page.locator('dialog[data-od-id="game-editor"]')).toHaveCount(0);

  /* 그리고 일정은 그대로다 — 저장이 날짜를 지우거나 옮기면 안 된다. 서버가 거절하지 않고
     통과했다면 여기 항목이 사라지거나 다른 날로 옮겨 간다. */
  await page.goto("/schedule?week=2026-02-16");
  await expect(page.locator('[data-od-id^="schedule-entry-title-"]')).toHaveValue("엘든 링 1일차");
});

/* 폼이 열린 뒤 일정이 딴 데서 바뀌었을 때, **날짜 칸을 안 건드린 저장은 그걸 되돌리지 않는다.**
   서버 precondition(playedDateWas)이 최종 방어선이지만 그 앞에 폼의 규약이 있다: 사용자가 날짜를
   고치지 않았으면 아예 안 싣는다. 안 실으면 서버는 일정을 건드리지 않으므로 CONFLICT 조차 안
   난다 — 클리어만 고치려던 관리자가 남의 일정 변경 때문에 막히면 그것대로 나쁘다.
   라우터 테스트는 "낡은 값을 실으면 CONFLICT"를 덮지만, **폼이 애초에 안 싣는지**는 실제 제출
   페이로드를 태워야 안다(리뷰 6라운드). */
test("관리자: 폼이 열린 뒤 일정이 바뀌어도 클리어만 고친 저장은 그대로 통과한다", async ({
  page,
  baseURL,
}) => {
  await signIn(page.context(), baseURL!);

  // 마인크래프트(id 2)는 항목이 하나라(2026-07-12) 폼이 그 날짜를 읽고 편집 가능한 상태로 연다.
  await page.goto("/games");
  await expectSignedIn(page);
  await openCard(page, "마인크래프트");
  await page.locator('[data-od-id="game-edit-2"]').click();
  await expect(page.locator('[data-od-id="editor-played"]')).toHaveValue("2026-07-12");

  /* 폼이 열린 채로 그 **날짜**가 딴 데서 옮겨진 상황을 만든다 — 다른 탭의 관리자가 하는 일이다.
     날짜여야 한다: 시각·제목만 바꾸면 precondition(playedDateWas)이 안 걸려 이 스펙이 아무것도
     증명하지 못한다(실제로 처음엔 시각을 바꿨다가 검출력이 0인 걸 확인했다). 07-13 으로 옮기는
     건 마인크래프트가 보드 1위(MAX)를 유지해 읽기 전용 스펙의 정렬 검증을 안 흔들기 때문이다. */
  const other = await page.context().newPage();
  await other.goto("/games");
  await openCard(other, "마인크래프트");
  await other.locator('[data-od-id="game-edit-2"]').click();
  await other.locator('[data-od-id="editor-played"]').fill("2026-07-13");
  await other.locator('[data-od-id="game-editor-submit"]').click();
  await expect(other.locator('dialog[data-od-id="game-editor"]')).toHaveCount(0);
  await other.close();

  /* 원래 폼에서 그대로 저장. 날짜 칸을 안 건드렸으므로 playedDate 를 안 싣고, 서버는 일정을
     건드리지 않아 **CONFLICT 조차 안 난다** — 클리어만 고치려던 관리자가 남의 일정 변경 때문에
     막히면 그것대로 나쁘다. 폼이 늘 싣던 시절엔 stale 한 07-12 가 실려 CONFLICT 로 막혔다.
     클리어를 안 켜는 건 읽기 전용 스펙이 보는 픽스처 상태를 안 흔들기 위해서다. */
  await page.locator('[data-od-id="game-editor-submit"]').click();
  await expect(page.locator('dialog[data-od-id="game-editor"]')).toHaveCount(0);

  // 남의 변경(07-13)이 살아 있다 — stale 한 폼이 07-12 로 되돌리지 않았다.
  await page.reload();
  await openCard(page, "마인크래프트");
  await page.locator('[data-od-id="game-edit-2"]').click();
  await expect(page.locator('[data-od-id="editor-played"]')).toHaveValue("2026-07-13");
});

/* 입력이 든 폼은 **배경 클릭·Esc 로 조용히 안 닫힌다**(GameDialog 의 dirty). 사용자가 지적한
   자리이고, 여기가 아니면 아무 게이트도 안 본다 — 이 가드는 브라우저의 dialog 닫기 경로에
   걸려 있어 단위 테스트로는 재현이 안 된다.

   **읽기 전용이다**: 열고 고치는 시늉만 하다 되돌린다. 서버로 나가는 저장이 없어 공유 픽스처를
   안 흔든다(이 파일 위쪽 주석의 규약). */
test("관리자: 고치던 폼은 배경을 클릭해도 확인 없이 닫히지 않는다", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!);
  await page.goto("/games");
  await expectSignedIn(page);

  await openCard(page, "스타듀 밸리");
  await page.locator('[data-od-id="game-edit-8"]').click();
  const editor = page.locator('dialog[data-od-id="game-editor"]');
  // 조회가 끝나기 전엔 입력이 잠긴다 — 그 전에 고치면 dirty 판정이 "아직 안 온 값"을 센다.
  await expect(page.locator('[data-od-id="editor-played"]')).toHaveValue("2026-01-05");

  /* 안 고친 폼은 그냥 닫힌다 — 잃을 게 없는데 되묻는 건 그냥 문이 하나 더 는 것이다.
     (좌표 (5,5)는 카드 상자 밖이라 배경 클릭으로 판정된다 — GameDialog 의 isOutside.) */
  await page.mouse.click(5, 5);
  await expect(editor).toHaveCount(0);

  // 이제 실제로 고친 뒤 같은 자리를 누른다.
  await page.locator('[data-od-id="game-edit-8"]').click();
  await expect(page.locator('[data-od-id="editor-played"]')).toHaveValue("2026-01-05");
  await page.locator('[data-od-id="editor-clear-cleared"]').check();
  await page.mouse.click(5, 5);

  // 안 닫혔고, 무엇을 잃는지 묻는다.
  const discard = page.locator('dialog[data-od-id="game-editor-discard"]');
  await expect(discard).toBeVisible();
  await expect(editor).toBeVisible();

  // 「계속 작성」은 고치던 값을 그대로 둔 채 폼으로 돌려보낸다.
  await page.locator('[data-od-id="game-editor-discard-keep"]').click();
  await expect(discard).toHaveCount(0);
  await expect(page.locator('[data-od-id="editor-clear-cleared"]')).toBeChecked();

  // Esc 도 같은 가드를 거친다 — 셸이 주는 닫기 셋이 한 규약을 쓴다.
  await page.keyboard.press("Escape");
  await expect(discard).toBeVisible();

  // 「닫기」를 골라야 비로소 폼이 닫힌다. 저장을 안 눌렀으니 서버엔 아무것도 안 갔다.
  await page.locator('[data-od-id="game-editor-discard-go"]').click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await openCard(page, "스타듀 밸리");
  await expect(page.locator('dialog[data-od-id="game-detail"]')).toContainText("미완료");
});

/* 상세를 닫자마자 다른 카드를 누르는 연타. **엔트리를 되돌리는 history.back() 은 비동기
   브라우저 왕복이라** 호출과 popstate 도착 사이에 창이 하나 열린다 — 그 사이에 열린 상세를
   뒤늦게 온 popstate 가 자기 것으로 알고 닫아 버렸다(리뷰 실측: 20배 스로틀에서 0~90ms,
   카드가 열렸다 스스로 닫히고 히스토리는 연타 6라운드에 3 → 10 으로 자랐다).

   **CPU 를 20배 조인다.** 이 배선이 존재하는 이유 자체가 저사양 안드로이드의 하드웨어
   뒤로가기라 그 조건이 곧 이 스펙의 무대다. 조이지 않으면 popstate 가 같은 프레임에 도착해
   경합 자체가 안 생기고, 배선이 통째로 틀려도 초록이다(실측 — 조이기 전엔 옛 코드도 통과했다).
   두 번째 클릭은 Playwright 가 아니라 **페이지 안에서** 닫힘 직후 프레임에 쏜다: 바깥에서
   보내면 액션 가능성 검사와 왕복이 스로틀에 늘어져 그 사이 popstate 가 먼저 도착한다.

   **읽기 전용이다**: 상세를 열고 닫기만 한다 — 공유 픽스처를 안 흔든다. */
test("게임: 상세를 닫자마자 다른 카드를 눌러도 그 카드가 열린 채 남는다", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await page.goto("/games");
  const detail = page.locator('dialog[data-od-id="game-detail"]');

  const opened: number[] = [];
  const lengths: number[] = [];
  for (let round = 0; round < 3; round++) {
    await openCard(page, "엘든 링");
    await expect(detail).toBeVisible();

    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await page.evaluate(() => {
      const open = document.querySelector('dialog[data-od-id="game-detail"]')!;
      open.addEventListener(
        "close",
        () => {
          // React 가 언마운트해 보드가 다시 눌리는 첫 프레임 — 사람이 낼 수 있는 최단 간격이다.
          const tick = () => {
            if (document.querySelector('dialog[data-od-id="game-detail"]')) {
              requestAnimationFrame(tick);
              return;
            }
            document.querySelector<HTMLButtonElement>('[data-od-id="game-open-2"]')!.click();
          };
          requestAnimationFrame(tick);
        },
        { once: true },
      );
    });
    await page.keyboard.press("Escape");
    // 조인 채로 기다려야 back 이 늦게 도착하는 그 창이 열린다.
    await page.waitForTimeout(200);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    // 늦게 온 popstate 가 마인크래프트 상세를 닫아 버렸다면 여기서 0 이 잡힌다.
    await page.waitForTimeout(800);

    opened.push(await detail.count());
    lengths.push(await page.evaluate(() => history.length));
    if (await detail.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(detail).toHaveCount(0);
      // 다음 라운드가 깨끗한 상태에서 시작하도록 이번 되돌리기가 도착할 시간을 준다.
      await page.waitForTimeout(200);
    }
  }

  expect(opened, "연타로 연 상세가 스스로 닫혔다").toEqual([1, 1, 1]);
  /* 엔트리가 새면 히스토리가 라운드마다 한 칸씩 자란다 — 화면엔 아무 표시도 안 나고,
     사용자에겐 "뒤로가기를 몇 번 눌러야 이 페이지를 떠나는지 모르겠다"로만 드러난다. */
  expect(new Set(lengths).size, "히스토리 엔트리가 샜다: " + lengths.join(",")).toBe(1);
});

/* **버려진 히스토리 엔트리를 다음 모달이 물려받지 않는다.**

   모달을 연 채 그 안의 링크로 페이지를 떠나면 우리가 쌓은 엔트리는 되돌려지지 않고 남는다
   (그렇게 하기로 한 결정이다 — 언마운트에서 back 을 부르면 이탈 자체를 무른다). 그 엔트리가
   **현재보다 뒤에** 놓이는 게 문제의 씨앗이다: 돌아와서 모달을 다시 열 때 컨트롤러가 "이미
   엔트리가 있다"며 새로 쌓지 않으면, 뒤로가기가 페이지를 떠나는데 컨트롤러는 그걸 자기
   엔트리로 알고 모달을 닫는다 — 이 배선의 약속("뒤로가기는 모달만 닫는다")이 정확히 거기서
   깨진다(적대적 리뷰가 코드로 지목했다).

   **클라이언트 네비게이션이어야 재현된다.** page.goto 는 문서를 새로 로드해 컨트롤러 상태까지
   초기화하므로 이 경로를 못 만든다. 모달이 열린 동안 nav 는 inert 라 사람은 누를 수 없지만,
   inert 가 막는 건 히트테스트·포커스이고 **프로그램적 click() 은 그대로 디스패치된다** — 그
   틈으로 실제 링크 이탈과 같은 상태를 만든다(사람이 실제로 밟는 문은 수정 폼 안의 /schedule
   링크지만 그건 여러 날 편성 게임에서만 렌더돼 D1 쓰기가 필요하다 — 컨트롤러가 보는 건
   "모달이 닫히지 않은 채 클라이언트 네비게이션이 일어났다" 하나뿐이라 어느 링크든 같다).

   읽기 전용이다 — 서버로 나가는 쓰기가 없다. */
test("게임: 모달을 연 채 떠났다 돌아와 다시 열면 뒤로가기가 모달만 닫는다", async ({ page }) => {
  await page.goto("/games");
  const detail = page.locator('dialog[data-od-id="game-detail"]');

  await page.locator('[data-od-id="game-open-1"]').click();
  await expect(detail).toBeVisible();

  // 모달이 열린 채 클라이언트 네비게이션으로 이탈 — 엔트리가 주인 없이 남는다.
  await page.evaluate(() => {
    const link = document.querySelector('.nav__links a[href="/landing"]') as HTMLAnchorElement;
    link.click();
  });
  await expect(page).toHaveURL(/\/landing$/);

  // 돌아와서 다시 연다. 여기서 새 엔트리를 안 쌓으면 아래 뒤로가기가 페이지를 떠난다.
  await page.locator('.nav__links a[href="/games"]').click();
  await expect(page).toHaveURL(/\/games$/);
  await page.locator('[data-od-id="game-open-1"]').click();
  await expect(detail).toBeVisible();

  await page.goBack();
  await expect(detail).toHaveCount(0);
  await expect(page, "뒤로가기가 모달만 닫는 대신 페이지를 떠났다").toHaveURL(/\/games$/);
});
