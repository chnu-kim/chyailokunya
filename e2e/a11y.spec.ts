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

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/* 라우트 정본은 `src/features/routes.ts` 지만 여기서는 **일부러 손으로 적는다** — 페이지가
   늘면 이 목록도 늘려야 하고, 그 사실은 `routes.spec.ts` 가 이미 강제한다(그 스펙이 app 을 훑어
   라우트 목록과 대조한다). 여기까지 파생시키면 스펙 하나가 두 정본을 동시에 파싱하게 된다. */
const PAGES = ["/", "/landing", "/games", "/schedule"] as const;

/* 좁은 폭도 같이 본다. 대비·이름은 폭과 무관하지만 **타깃 크기와 겹침은 폭에서 갈린다** —
   이 저장소가 320px 를 기준 폭으로 삼는 이유(WCAG 1.4.10 reflow)와 같은 자리다. */
const WIDTHS = [
  { label: "데스크톱", width: 1280, height: 900 },
  { label: "320px", width: 320, height: 800 },
] as const;

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

        /* 실패 메시지에 **어느 요소가 왜** 걸렸는지를 싣는다. axe 결과를 그대로 toEqual 하면
           수백 줄 JSON 이 나와 정작 무엇을 고쳐야 하는지가 안 보인다. */
        const summary = violations.map(
          (v) => `[${v.id}] ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        );
        expect(summary, `${path} (${label})`).toEqual([]);
      });
    }
  });
}
