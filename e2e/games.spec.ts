import { expect, test } from "@playwright/test";

// 카드만 세는 로케이터 — 붙이기 슬롯(.addslot)과 유령(.game--ghost)은 제외한다.
const CARDS = ".game:not(.game--ghost)";

test("게임: 시드 8장·상태 필터·추가·삭제·되돌리기", async ({ page }) => {
  await page.goto("/games");

  const cards = page.locator(CARDS);
  await expect(cards).toHaveCount(8);
  await expect(page.locator(".head__count")).toContainText("총");

  // 필터: 플레이중 → 2장(마인크래프트·리그 오브 레전드)
  await page.getByRole("button", { name: "플레이중" }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "마인크래프트" })).toBeVisible();

  // 전체로 복귀
  await page.getByRole("button", { name: "전체" }).click();
  await expect(cards).toHaveCount(8);

  // 추가 — 다이얼로그를 열고 붙인다(폼은 열린 채로 결과를 카드 안에서 알린다)
  await page.getByRole("button", { name: "새 게임 붙이기" }).click();
  const dialog = page.locator("dialog.composer");
  await expect(dialog).toBeVisible();
  await page.getByLabel("게임명").fill("테스트게임");
  // "붙이기"(submit)만 — "새 게임 붙이기"(슬롯)와 겹치지 않게 정확히 매칭한다.
  await page.getByRole("button", { name: "붙이기", exact: true }).click();
  await expect(dialog.locator(".composer__added")).toContainText("붙였어요");

  // Esc 로 닫으면 폼이 비워지고, 새 카드가 보드에 남는다
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "테스트게임" })).toBeVisible();
  await expect(cards).toHaveCount(9);

  // 삭제 → 유령이 자리에 들어서고, 되돌리면 카드가 복구된다
  await page.getByRole("button", { name: "테스트게임 삭제" }).click();
  await expect(page.getByText("‘테스트게임’ 뗐어요.")).toBeVisible();
  await expect(cards).toHaveCount(8);
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(page.getByRole("heading", { name: "테스트게임" })).toBeVisible();
  await expect(cards).toHaveCount(9);
});
