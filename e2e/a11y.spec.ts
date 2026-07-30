/* 접근성 자동 스캔(axe-core) — 검증 층 3 에 붙는 가로축(ADR-0029).

   **왜 기계가 세야 하는가.** AGENTS 의 접근성 기준은 "협상 대상 아님"인데 지금까지 그걸 보는
   것은 `narrow-body.spec.ts` 의 **손으로 열거한 셀렉터 목록** 하나뿐이었다. 본문에 인터랙티브
   요소를 더하고 그 목록에 안 적으면 게이트가 전부 초록인데 그 버튼만 검사 밖이다(AGENTS 가
   지뢰로 적어 둔 그대로). 대비도 마찬가지다 — 손계산이 틀려 잘못된 값이 주석·PR 에 커밋된
   적이 있다.

   axe 는 목록을 안 받는다. 페이지에 있는 것을 전부 훑어 대비·ARIA·라벨·랜드마크·이름을 센다.

   **기존 위반을 baseline 으로 봉인하지 않는다**(ADR-0029 기각한 대안) — 봉인된 위반은 영영
   남는다. 나오면 고친다.

   규칙 태그는 WCAG 2.1 AA 로 좁힌다. axe 기본값엔 `best-practice` 가 섞여 있는데 그건 권고지
   기준이 아니라, 섞어 두면 "기준 위반"과 "취향"이 한 실패로 보여 판단이 흐려진다. */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Result } from "axe-core";
import { KNOWN_PAGE_PATHS } from "@/features/routes";

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/* **라우트 목록은 정본에서 가져온다 — 손으로 적지 않는다.** 한때 여기 배열을 직접 적어 두고
   "`routes.spec.ts` 가 강제하니 괜찮다"고 근거를 달았는데 **그 근거가 틀렸다**(리뷰 지적):
   그 스펙이 대조하는 건 `src/app` ↔ `KNOWN_PAGE_PATHS` 지 이 파일의 목록이 아니다. 페이지를
   더하고 `routes.ts` 와 `app/` 만 고치면 routes.spec 은 초록인데 axe 는 그 페이지를 영영 안
   본다 — 이 파일 맨 위에서 비판하는 `narrow-body.spec.ts` 의 손 열거 함정과 **같은 모양**이다.

   Playwright 스펙은 Node 라 정본을 그대로 import 할 수 있다(`routes.spec.ts` 도 그렇게 한다). */
const PAGES = KNOWN_PAGE_PATHS;

/* 좁은 폭도 같이 본다. 대비·이름은 폭과 무관하지만 **타깃 크기와 겹침은 폭에서 갈린다** —
   이 저장소가 320px 를 기준 폭으로 삼는 이유(WCAG 1.4.10 reflow)와 같은 자리다. */
const WIDTHS = [
  { label: "데스크톱", width: 1280, height: 900 },
  { label: "320px", width: 320, height: 800 },
] as const;

/* 실패 메시지에 **어느 요소가 왜** 걸렸는지를 싣는다. axe 결과를 그대로 비교하면 수백 줄
   JSON 이 나와 정작 무엇을 고쳐야 하는지가 안 보인다. */
function summarize(violations: Result[]): string[] {
  return violations.map(
    (v) => `[${v.id}] ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

for (const { label, width, height } of WIDTHS) {
  test.describe(`axe · ${label}`, () => {
    for (const path of PAGES) {
      test(`${path} 에 WCAG 2.1 AA 위반이 없다`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        // 등장 애니메이션이 도는 중에 스캔하면 대비·가시성 판정이 흔들린다(reduced-motion 은
        // 이 저장소의 다른 스펙과 같은 이유로 스펙 안에서 켠다 — project-level use 는 타입이 거부).
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(path);

        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();

        expect(summarize(violations), `${path} (${label})`).toEqual([]);
      });
    }

    /* **모달을 안 열면 이 앱의 인터랙티브 표면 대부분이 스캔 밖이다.** 위 넷은 페이지의 초기·
       닫힌 상태만 본다 — 그런데 이 저장소가 접근성으로 실제 애를 먹은 자리는 대개 다이얼로그
       쪽이었다(포커스 복원·inert·터치 타깃). 게임 상세는 **공개**라 세션 없이 열 수 있어 여기
       한 장을 표본으로 넣는다.

       관리자 전용 모달(편집기·제안함·발행 확인)은 여전히 스캔 밖이다 — 신원이 갈리는 화면은
       세션을 심어야 하고, 그건 `narrow-body.spec.ts` 가 이미 세션을 바꿔 가며 재는 자리라
       거기로 미룬다. **"axe 가 접근성을 본다"는 말은 그 범위까지 참이 아니다.** */
    test("게임 상세 다이얼로그에 WCAG 2.1 AA 위반이 없다", async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/games");

      await page.locator(".game").filter({ hasText: "엘든 링" }).getByRole("button").click();
      const detail = page.locator('dialog[data-od-id="game-detail"]');
      // 열린 걸 확인하고 스캔한다 — 안 열렸는데 통과하면 검출력 0 인 테스트가 된다.
      await expect(detail).toBeVisible();

      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();

      expect(summarize(violations), `game-detail (${label})`).toEqual([]);
    });
  });
}
