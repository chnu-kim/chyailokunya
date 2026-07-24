/* 게임 추가 컴포저의 검색 단계 = WAI-ARIA 콤보박스. 여기서만 잡히는 게 있어서 스펙을 나눴다:
   role·id·aria 배선은 **틀려도 조용하다.** aria-activedescendant 가 없는 id 를 가리켜도 예외가
   안 나고, li 가 option 이 아니어도 화면은 똑같이 그려진다 — 게이트 여덟 개가 전부 초록인
   채로 키보드 사용자만 목록을 못 쓴다. 전이 규칙(커서가 언제 접히는가)은 순수 리듀서가
   단위 테스트로 못박고(core/games-composer.test.ts), 그 규칙이 **실제 DOM 에 붙었는가**를
   이 스펙이 본다.

   검색 응답을 가로채는 이유: 검색은 서버 프록시를 거쳐 치지직 카테고리 API 로 나가는데
   `.dev.vars.e2e` 엔 치지직 자격증명이 없다(공개 읽기만 하던 시절의 파일이고, 넣으면 e2e 가
   외부 API 의 가용성과 검색 순위에 묶인다). 가로채면 목록이 결정적이 되고 서버 경로는 그대로
   돈다 — 이 스펙이 보려는 건 어차피 응답이 아니라 **응답을 받은 뒤의 배선**이다.
   저장소에서 page.route 를 쓰는 첫 스펙이라 근거를 여기 남긴다.

   D1 은 안 건드린다(추가까지 안 간다) — 픽스처 하나를 공유하는 다른 스펙과 안 싸운다.
   같은 이유로 **방금 추가한 카드의 강조 링(.game--just-added)은 이 스펙도 다른 스펙도 안
   덮는다**: 그걸 보려면 실제로 게임을 추가해야 하는데, e2e 는 fullyParallel 이라 카드 수(8)와
   정렬을 못박은 읽기 스펙이 그 순간 조용히 빨개진다. 링은 사람이 본다. */
import { expect, test, type Page } from "@playwright/test";
import { expectSignedIn, signIn } from "./session";

/* 검색어 '게임' 과 **정확히 같은 이름이 하나도 없는** 목록이어야 한다 — 그래야 직접 추가가
   목록 맨 위(과제 D)에 붙어 항목이 4개가 되고, 커서가 그 줄까지 도는지 볼 수 있다
   (showsDirectEntry). */
const RESULTS = [
  { categoryType: "GAME", categoryId: "c-1", categoryValue: "젤다", posterImageUrl: null },
  { categoryType: "GAME", categoryId: "c-2", categoryValue: "마리오", posterImageUrl: null },
  { categoryType: "GAME", categoryId: "c-3", categoryValue: "마인크래프트", posterImageUrl: null },
];

// 컴포저를 열고 결정적 결과가 뜬 상태까지 간다. 추가 버튼은 쓰기 권한 뒤라 로그인이 먼저다.
async function openComposer(page: Page, baseURL: string) {
  /* 커서 표시(.composer__pick--active)는 border-color 에 transition 이 걸려 있다(games.css
     .composer__pick). 감속 선호를 켜면 전역 가드(chrome.css)가 duration 을 0.001ms 로
     죽여 클래스가 붙는 순간 계산된 값이 바로 최종값이 된다 — 안 켜면 활성 줄의 테두리를
     읽는 단언이 전환 도중 값(전체 투명과 --border-strong 사이 보간)을 잡을 수 있다(실측).
     e2e/visual.spec.ts 가 스냅샷에 쓰는 것과 같은 장치다. */
  await page.emulateMedia({ reducedMotion: "reduce" });
  // transformer 를 안 쓰는 vanilla httpLink 라 응답은 평범한 {result:{data}} 다(trpc/client).
  await page.route("**/api/trpc/chzzk.categorySearch*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { data: RESULTS } }),
    }),
  );
  await signIn(page.context(), baseURL);
  await page.goto("/games");
  await expectSignedIn(page);
  await page.locator('[data-od-id="composer-open"]').click();
  return page.locator('[data-od-id="composer-input"]');
}

test("컴포저 검색: 화살표·Home/End 로 커서가 돌고 Esc 는 커서만 접는다", async ({
  page,
  baseURL,
}) => {
  const box = await openComposer(page, baseURL!);
  await expect(box).toHaveAttribute("role", "combobox");
  // 목록이 없을 땐 펼침이 아니다 — 빈 listbox 를 펼쳤다고 말하면 ↓ 가 안 먹는 이유가 안 읽힌다.
  await expect(box).toHaveAttribute("aria-expanded", "false");

  await box.fill("게임");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(4); // 결과 3 + 직접 추가 한 줄
  await expect(box).toHaveAttribute("aria-expanded", "true");
  // 아직 아무것도 안 가리킨다 — 없으면 속성 자체가 없어야 한다(빈 값이나 없는 id 는 낭독을 죽인다).
  expect(await box.getAttribute("aria-activedescendant")).toBeNull();

  /* **자리부터 못박는다.** 결과가 3건이나 있어도 목록의 첫 줄이 직접 추가다(과제 D) — 옛
     자리(목록 끝)에선 12건을 다 지나야 만났는데, 그 줄이 필요한 사람은 정확히 "결과에서 못
     찾은" 상황에 있다. 아래 커서 단언이 인덱스 0 을 재지만 **인덱스와 자리는 다른 것**이라
     DOM 순서를 따로 본다.
     라벨까지 함께 재는 이유: 맨 위라는 자리는 "이게 첫 번째 검색 결과인가"로도 읽혀 위계를
     스스로 못 진다 — 그 몫을 문구가 진다(‘찾는 게임이 없다면’ 이 먼저 온다). 자리만 재면
     문구를 옛 판(‘○○’ 직접 추가)으로 되돌려도 초록이다. */
  await expect(options.nth(0)).toHaveAttribute("data-od-id", "composer-direct");
  await expect(options.nth(0)).toHaveText("찾는 게임이 없다면 ‘게임’ 직접 추가");

  /* 그래서 아무것도 안 가리키던 상태의 ↓ 첫 타는 그 줄로 들어간다 — 시각 순서와 키보드
     순서를 맞춘 결정이다(core.DIRECT_ENTRY_INDEX=0). */
  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", "composer-option-0");
  await expect(page.locator('[data-od-id="composer-direct"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  /* 커서는 눈에도 보여야 한다. 클래스가 붙었는지만 보면 CSS 규칙을 지워도 초록이라(실측)
     **칠해진 결과**를 잰다 — 이 줄의 표시를 성립시키는 건 면이 아니라 테두리다(면은 표면 대비
     1.1:1). 이웃 줄과 테두리 색이 같아지는 순간 커서는 키보드 사용자에게 사라진 것이다. */
  await expect(options.nth(0)).toHaveClass(/composer__pick--active/);
  const borders = await options.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).borderTopColor),
  );
  expect(borders[0], "커서 줄의 테두리가 이웃과 구분되지 않는다").not.toBe(borders[1]);

  // End 는 반대로 **마지막 결과**로 들어간다 — 검색 결과를 찾던 사람이 순환으로 손해 보지 않게.
  await box.press("End");
  await expect(box).toHaveAttribute("aria-activedescendant", "composer-option-3");
  await expect(options.nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-od-id="composer-direct"]')).toHaveAttribute(
    "aria-selected",
    "false",
  );

  // 끝(마지막 결과)에서 ↓ 는 처음(직접 추가)으로, 처음에서 ↑ 는 다시 끝으로 순환한다.
  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", "composer-option-0");
  await box.press("ArrowUp");
  await expect(box).toHaveAttribute("aria-activedescendant", "composer-option-3");
  await box.press("Home");
  await expect(box).toHaveAttribute("aria-activedescendant", "composer-option-0");

  /* Esc 는 커서가 있을 때만 소비한다 — 이 모달의 Esc 는 '닫기'로 이미 확립돼 있어 통째로
     뺏으면 안 된다. 그다음 Esc 는 흘러가서 UA 의 검색 입력 기본 동작(값 비우기)이 먹고,
     그러고도 남는 Esc 가 모달을 닫는다. 가운데 한 칸은 type=search 가 주는 UA 동작이라
     이 컴포저의 규칙이 아니다(실측으로 확인한 순서라 그대로 못박아 둔다). */
  await box.press("Escape");
  expect(await box.getAttribute("aria-activedescendant")).toBeNull();
  await expect(page.locator("dialog.composer")).toBeVisible();
  await expect(box).toHaveValue("게임");

  await box.press("Escape");
  await expect(box).toHaveValue("");
  await expect(page.locator("dialog.composer")).toBeVisible();

  await box.press("Escape");
  await expect(page.locator("dialog.composer")).toHaveCount(0);
});

test("컴포저 검색: Enter·클릭·포인터가 같은 목록을 가리킨다", async ({ page, baseURL }) => {
  const box = await openComposer(page, baseURL!);
  await box.fill("게임");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(4);

  /* 자동 검색이라 "검색 버튼을 눌렀다"는 사건이 없다 — 결과가 도착한 사실은 이 한 줄이
     말하는 게 전부다. 문구에 검색어가 실려 있어야 다음 검색이 같은 건수를 줘도 발화한다. */
  await expect(page.locator('[data-od-id="composer-search-status"]')).toHaveText(
    "‘게임’ 검색 결과 3건이에요.",
  );

  /* 항목이 li 로 바뀌며 버튼이 들고 있던 44 하한이 따라왔는가 — 진짜 검색 결과 줄로 잰다.
     nth(0) 은 이제 직접 추가다(과제 D, 맨 위); nth(1) 이 첫 검색 결과(젤다)다. */
  const firstResult = (await options.nth(1).boundingBox())!;
  expect(firstResult.height, "결과 한 줄이 44 아래로 내려갔다").toBeGreaterThanOrEqual(44);

  // 포인터가 지나간 줄이 곧 커서다 — hover 를 따로 칠하지 않으므로 이게 유일한 표시다.
  // nth(2) = 결과의 두 번째 줄(마리오, 직접 추가가 인덱스 0 을 차지해 결과가 한 칸씩 밀렸다).
  await options.nth(2).hover();
  await expect(box).toHaveAttribute("aria-activedescendant", "composer-option-2");

  // Enter 는 커서가 가리키는 항목을 고른다(= 클릭과 같은 동작).
  await box.press("Enter");
  await expect(page.locator('[data-od-id="composer-chosen"]')).toContainText("마리오");

  await page.locator('[data-od-id="composer-back"]').click();
  await expect(page.getByRole("option")).toHaveCount(4);
  // 뒤로 온 목록에 커서가 남아 있으면 '이미 고른 행'으로 읽힌다.
  expect(await box.getAttribute("aria-activedescendant")).toBeNull();
  await expect(box).toBeFocused();

  // 마우스 경로도 그대로 산다 — 항목이 button 이 아니게 됐어도 클릭이 곧 선택이다.
  await page.locator('[data-od-id="composer-direct"]').click();
  await expect(page.locator('[data-od-id="composer-chosen"]')).toContainText("게임");
});

/* **손을 안 떼고 끝까지 간다.** 위 두 스펙이 '커서가 도는가'(키보드)와 '고르면 상세로 가는가'
   (포인터로 얹은 커서 + Enter)를 각각 보는데, 둘을 이어 붙인 **순수 키보드 경로**는 어느 쪽도
   안 지난다 — 이 콤보박스를 만든 이유가 바로 그 경로라 여기가 비면 정작 주인공이 안 잡힌다. */
test("컴포저 검색: 화살표로 내려가 Enter 로 결과를 고른다", async ({ page, baseURL }) => {
  const box = await openComposer(page, baseURL!);
  await box.fill("게임");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(4);

  // ↓ 첫 타는 맨 위(직접 추가)라, 첫 검색 결과에 닿으려면 한 번 더 눌러야 한다.
  await box.press("ArrowDown");
  await box.press("ArrowDown");

  /* **칠해진 줄과 Enter 가 집는 줄을 함께 잰다.** Enter 결과만 보면 결과 인덱스가 한 칸
     안 밀린 회귀(화면이 core.composerResultIndex 를 안 거치고 i 를 그대로 쓰는 경우)가 초록
     으로 통과한다 — 그때 커서는 두 번째 결과에 칠해져 있는데 Enter 는 첫 결과를 집어, 결과만
     보면 맞아떨어진다. 둘이 갈리는 게 이 배선의 실패 모습이라 둘 다 본다. */
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(box).toHaveAttribute("aria-activedescendant", "composer-option-1");

  /* **커서가 움직여도 포커스는 입력에 남는다** — 콤보박스 규약의 핵심이고, 깨지면 이어 치던
     검색어를 계속 못 친다. 위 두 스펙이 이걸 못 본다: `press()` 는 대상을 먼저 포커스하므로
     항목이 포커스를 훔쳐 갔어도 다음 press 가 조용히 되돌려 놓는다. 여기서만 잡힌다. */
  await expect(box).toBeFocused();

  await box.press("Enter");
  await expect(page.locator('[data-od-id="composer-chosen"]')).toContainText("젤다");
  // 상세로 넘어갔으면 검색 목록은 그 화면에 없다 — 단계가 실제로 갈렸다는 뜻이다.
  await expect(page.getByRole("option")).toHaveCount(0);
  /* 그리고 **포커스가 따라간다.** 방금 누른 항목은 자기 자신을 언마운트하므로, 안 옮기면
     포커스가 dialog 로 떨어져 키보드 사용자는 화면이 통째로 바뀐 걸 모른 채 Tab 을 처음부터
     훑는다(game-composer 의 단계 포커스 effect). 화면상 아무 표시도 안 나는 회귀라 여기가
     아니면 아무도 안 본다. */
  await expect(page.locator('[data-od-id="composer-submit"]')).toBeFocused();
});
