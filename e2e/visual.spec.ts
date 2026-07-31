import { expect, test } from "@playwright/test";
import { openDay } from "./schedule-helpers";
import { expectSignedIn, signIn } from "./session";

/* 시각 스냅샷 베이스라인 — 3페이지 × 라이트/다크. 이 사이트는 prefers-color-scheme 가 아니라
   data-theme 로 테마를 정하므로, 첫 페인트 전 인라인 스크립트가 읽는 localStorage("theme")를
   goto 전에 심어 테마를 확정한다. 웹폰트가 다 로드된 뒤(document.fonts.ready) 찍고, 등장
   애니메이션은 config 의 reduced-motion + animations:"disabled" 로 꺼 안정화한다.

   베이스라인은 OS 별 파일이라(‑darwin/‑linux) CI(리눅스) 스모크에는 안 들어간다 — 로컬 dev
   회귀용이다. 처음 생성: npm run e2e:visual:update. 시각 패리티 판단은 사람 몫이다. */
const PAGES = [
  { name: "home", path: "/" },
  { name: "landing", path: "/landing" },
  { name: "games", path: "/games" },
] as const;

for (const p of PAGES) {
  for (const theme of ["light", "dark"] as const) {
    test(`시각: ${p.name} · ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
        } catch {
          // storage 가 막혀도 인라인 스크립트가 OS 선호로 떨어질 뿐 — 스냅샷엔 무해.
        }
      }, theme);

      // 등장 애니메이션을 꺼 스냅샷을 안정화한다(toHaveScreenshot 의 animations:"disabled"
      // 와 이중 안전장치). config 의 project use 대신 여기서 켠다 — 타입 이유(위 config 주석).
      await page.emulateMedia({ reducedMotion: "reduce" });

      await page.goto(p.path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(`${p.name}-${theme}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}

/* 로그인 상태는 오래 시각 베이스라인이 0 장이었다(이슈 #23) — 헤더 재편 때 계정 영역을 크게
   고치고도 스냅샷이 한 장도 안 흔들렸다. 이제 세션 fixture 가 있으니 한 장 찍는다.

   페이지가 아니라 nav 만, 라이트만 찍는다. 로그인이 바꾸는 건 헤더의 계정 영역 하나뿐이고,
   다크는 같은 토큰 경로를 타서 위 6장이 이미 덮는다. 폭은 1280 — 이름이 안 잘리는 계약이
   사는 폭이다(nav-touch-target.spec.ts 의 채널명 단언과 같은 자리).

   범위를 좁혀도 **본문에서 완전히 독립하진 못한다**: .nav 는 반투명 + backdrop-filter:blur(8px)
   라 뒤에 깔린 히어로가 블러된 채 이 한 장에 구워진다. 홈 상단을 바꾸면 이 베이스라인도 같이
   깨진다 — 그건 nav 회귀가 아니라 예상된 갱신이니 그때 재생성한다(npm run e2e:visual:update). */
test("시각: nav 로그인 상태 · light", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("theme", "light");
    } catch {
      // 위 스냅샷들과 같은 이유로 무해하다.
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page.context(), baseURL!);

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectSignedIn(page);
  await page.evaluate(() => document.fonts.ready);

  await expect(page.locator(".nav")).toHaveScreenshot("nav-signed-in-light.png", {
    animations: "disabled",
  });
});

/* 게임 보드의 **쓰기 권한 상태**. 위 games 두 장은 로그아웃이라 수정·삭제 액션이 DOM 에
   아예 없다 — 그 줄이 세 번(툴바 판 → 원형 칩 → 사진 밑 잉크 자국) 갈아엎히는 동안 시각
   회귀가 매번 초록이었는데, 잘 돌아서가 아니라 **안 봤기 때문**이다. 그 공백을 메운다.

   nav 스펙과 달리 **두 테마 다 찍는다.** 이 줄이 쓰는 --fg-muted·--danger 는 다크에서
   .polaroid 사진지 섬이 라이트 값으로 되돌리는 토큰이라(chrome.css), 되돌림이 깨지면
   크림 종이 위에서 조용히 씻긴다 — 그게 이 부품의 유일한 접근성 실패 경로고 라이트 한 장은
   그걸 못 본다. 대비 계산이 잡는 축이지만 계산은 사람이 안 돌리면 안 돌아간다.

   범위는 카드 하나가 아니라 **.games 격자 전체**다. 액션 줄이 카드를 50px 높이는데,
   액션 줄이 없는 .addslot(게임 추가)과 기준선이 어긋나는지는 격자를 봐야 드러난다.
   .addslot 은 이제 align-self:start 로 늘어나기를 거부하므로(games.css) 카드 키가 서로
   다른 게 정상이다 — 라벨과 .game__name 의 기준선 대응은 그래도 유지된다(offsetTop 어긋남
   0). 픽스처가 결정적이라(e2e/fixtures/games.sql, poster null) 격자를 넓게 잡아도
   흔들리지 않는다.

   **라이트 한 장은 카드 키 변화를 못 잡는다 — 이 베이스라인의 알려진 맹점이다.** .addslot 이
   줄면서 드러나는 자리가 라이트에선 흰 종이(#fff) → 거의 흰 노트 배경이라 픽셀 차가
   Playwright 기본 threshold 0.2(YIQ) 아래로 떨어져 **낡은 베이스라인이 초록으로 통과했다**
   (다크는 크림 섬 → 검정이라 21254px 로 즉시 빨개졌다). 실제로 이번에 라이트 파일을 지우고
   다시 구워야 했다. 카드 기하를 바꿨는데 다크만 빨개지면 라이트가 무사한 게 아니라 못 본
   것이다 — 두 장 다 지우고 재생성해라. */
for (const theme of ["light", "dark"] as const) {
  test(`시각: games 쓰기 권한 · ${theme}`, async ({ page, baseURL }) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {
        // 위 스냅샷들과 같은 이유로 무해하다.
      }
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // 격자가 한 화면에 다 들도록 키운다. 안 그러면 Playwright 가 요소를 뷰포트로 스크롤하는데
    // nav 가 sticky 라 격자 위에 겹쳐 구워진다 — 그러면 nav 를 고칠 때마다 이 베이스라인이
    // 엉뚱하게 깨진다(로그인 nav 스냅샷이 히어로 블러에 물린 것과 같은 종류의 결합).
    await page.setViewportSize({ width: 1280, height: 1600 });
    await signIn(page.context(), baseURL!);

    await page.goto("/games");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectSignedIn(page);
    await page.evaluate(() => document.fonts.ready);
    /* 쓰기 권한이 격자에 실제로 드러났는지 먼저 못박는다 — 권한이 빠지면 이 스냅샷은 위
       로그아웃 두 장과 같은 그림이 되어 "찍었는데 아무것도 안 본" 초록이 된다.
       한때 여기서 카드의 수정 버튼을 봤는데, 수정·삭제가 상세 모달로 내려가며 격자에서
       사라졌다 — 지금 격자에 남은 권한의 흔적은 첫 칸의 빈 종이 하나뿐이다. */
    await expect(page.locator('[data-od-id="composer-open"]')).toBeVisible();

    await expect(page.locator(".games")).toHaveScreenshot(`games-signed-in-${theme}.png`, {
      animations: "disabled",
    });
  });
}

/* 겹친 다이얼로그의 시각 구성. **이 상태는 다른 스냅샷이 하나도 안 덮는다** — 위 여섯 장은
   모달이 닫힌 화면이고, `games 쓰기 권한` 두 장은 `.games` 격자만 찍는다. 그래서 백드롭 농도와
   두 카드의 겹침이 시각 회귀 밖에 있었고, 실제로 그 자리에서 결함이 났다: 아래 상세가 그대로
   비쳐 흰 카드 둘이 어긋나 보이는 걸 사용자가 라이브에서 지적했다(PR #76).

   스모크가 못 보는 것을 이 장이 본다. 거긴 "아래가 opacity 0 인가"를 값으로 재지만, 그 결과가
   **어떻게 보이는가**(스크림이 한 겹인지, 카드가 어디 앉는지, 테마마다 같은지)는 사람이 판단할
   그림이 있어야 한다.

   범위가 뷰포트 전체인 이유: 백드롭이 이 장의 주인공이라 모달만 잘라내면 정작 볼 것이 빠진다.
   fullPage 는 안 쓴다 — 모달이 뜬 채로 페이지를 이어 붙이면 top layer 가 스크롤을 안 따라와
   그림이 어긋난다. */
for (const theme of ["light", "dark"] as const) {
  test(`시각: 겹친 다이얼로그(상세 위 수정) · ${theme}`, async ({ page, baseURL }) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {
        // 위 스냅샷들과 같은 이유로 무해하다.
      }
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page.context(), baseURL!);

    await page.goto("/games");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectSignedIn(page);
    await page.evaluate(() => document.fonts.ready);

    await page.locator('[data-od-id="game-open-1"]').click();
    await page.locator('[data-od-id="game-edit-1"]').click();
    /* 조회가 끝나기 전에 찍으면 잠긴 입력이 구워진다 — 값이 든 걸 보고 시작한다
       (games.spec 의 같은 자리와 같은 이유). */
    await expect(page.locator('[data-od-id="editor-played"]')).toHaveValue("2026-03-01");

    await expect(page).toHaveScreenshot(`stacked-dialog-${theme}.png`, {
      animations: "disabled",
    });
  });
}

/* 주간 일정 **편집기**. 이 화면은 시각 베이스라인이 하나도 없었는데(#130·#131 이전 11장은 전부
   home·landing·games·nav), 2026-07-31 의 3부작이 `schedule.css` 의 편집기 구역을 통째로 다시
   썼다 — 2열 골격 · 하루 머리 줄 · 표지 아이콘 · 휴방 잠금 · 미리보기. 앞으로 이 화면을 고칠 때
   무엇이 함께 움직였는지 볼 눈이 필요하다.

   **폭은 1400 이다** — 편집기만 넓힌 값이고(schedule.css) 그보다 좁으면 2열 자체가 안 뜬다.
   **높이 2200 은 편집기 전체(실측 2033)보다 크게 잡은 값이다.** 첫 판은 1700 이었는데 요소가
   뷰포트보다 커서 Playwright 가 스크롤했고, sticky 인 nav 와 저장 바가 **그림 중간에 겹쳐
   구워졌다** — 제목이 nav 에 가리고 저장 바가 토요일 카드 위에 앉았다(games 스냅샷 주석이
   경고한 바로 그 결합: 그 둘을 고칠 때마다 이 베이스라인이 엉뚱하게 깨진다). 요소가 한 번에
   들어가면 스크롤이 없어 sticky 가 제자리에 머문다.

   **주를 못박는 이유**가 하나 더 있다: `?week=` 없이 열면 "오늘" 칩이 이번 주 어딘가에 찍혀
   **날짜가 바뀔 때마다 스냅샷이 달라진다**. 픽스처가 안 건드리는 먼 과거 주를 고정해 오늘이 그
   안에 절대 안 들어가게 한다 — 간헐 실패를 설계로 없앤다.

   상태를 손으로 만든다(항목 둘 · 휴방 하나): 빈 주를 찍으면 이번 개편이 바꾼 것들이 그림에
   거의 안 나온다 — 항목 행도 잠금도 카드 내용도 전부 "무언가 들어 있을 때" 생긴다. (한때
   공지도 함께 채웠는데 그 입력이 없어졌다 — 결정 35 짝.)

   **뷰포트는 1600 이다**(1400 에서 올렸다, 2026-08-01). 2열 진입폭이 결정 31 로 1300→1440 이
   되면서 옛 1400 은 **1열**이 됐고, 그러면 이 베이스라인이 이 화면의 주 모양(폼 + 미리보기를
   나란히 보는 2열)을 더는 안 담는다 — 실제로 높이가 1157→1893 으로 늘며 완전히 다른 그림이
   됐다. 1600 은 편집 열이 상한(760)까지 벌어지는 첫 폭이라, 이 그림이 "가장 넓을 때의 배치"를
   담는다. 2열 진입폭을 또 옮기면 이 값도 같이 옮긴다.

   **이 베이스라인이 담는 아코디언 상태(결정 28, 2026-07-31 후속) — 재생성 전에 꼭 읽는다:**
   한 번에 하나만 펼쳐지므로 월·화·수를 순서대로 열어 각자 항목을 채우면 앞서 연 날은 자동으로
   접힌다. **마지막에 연 수요일(index 2)만 펼쳐진 채로 찍힌다** — 휴방 잠금(점선 + 흐림 + 안내)이
   패널 안에만 있어 접히면 그 디테일이 그림에서 사라지기 때문이다. 월·화는 접힌 요약 줄에 채운
   제목이 그대로 보인다(결정 28 이 지키는 "요약도 draft 를 그린다" 계약). 이 스펙을 손보다 순서를
   바꾸면 어느 날이 펼쳐진 채 굽히는지도 같이 바뀐다 — `e2e:visual:update` 전에 이 문단부터 고친다. */
for (const theme of ["light", "dark"] as const) {
  test(`시각: 주간 일정 편집기 · ${theme}`, async ({ page, baseURL }) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {
        // 위 스냅샷들과 같은 이유로 무해하다.
      }
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1600, height: 2200 });
    await signIn(page.context(), baseURL!);

    // 다른 스펙이 안 읽는 먼 과거 주 — 오늘이 여기 들 일이 없다.
    await page.goto("/schedule?week=2019-04-01");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectSignedIn(page);
    await page.evaluate(() => document.fonts.ready);

    /* 공지를 채우던 줄이 있었다 — 공지 입력을 걷으며(결정 35 짝) 사라졌고, 그래서 이 스냅샷의
       카드에는 이제 공지 블록이 없다. 베이스라인을 갱신할 때 그 차이가 의도된 것이다. */
    const add = page.locator('[data-od-id^="schedule-day-add-"]');
    const titles = page.locator('[data-od-id^="schedule-entry-title-"]');
    // 한 번에 하나만 열리므로(결정 28) 날마다 openDay 로 편 뒤 그 안의 유일한 add·title 을
    // .first() 로 잡는다 — 열려 있는 패널이 하나뿐이라 인덱스(nth)가 필요 없어졌다.
    await openDay(page, 0);
    await add.first().click();
    await titles.first().fill("마인크래프트 — 건축 계속");
    await openDay(page, 1);
    await add.first().click();
    await titles.first().fill("저챗");
    // 휴방 잠금(점선 + 흐림 + 안내)이 그림에 들도록 항목이 있는 날을 쉬게 하고, 이 날을 편
    // 채로 찍는다(위 파일 상단 주석 참고).
    await openDay(page, 2);
    await add.first().click();
    await titles.first().fill("이 항목은 안 나갑니다");
    await page.locator('[data-od-id^="schedule-day-rest-"]').first().check();

    /* 카드가 입력을 실제로 따라왔는지 보고 찍는다 — 안 기다리면 옛 상태가 구워져, 이 장이
       지키려는 계약("미리보기가 편집 중인 값을 그린다")을 정작 스냅샷이 안 담는다. */
    await expect(page.locator('[data-od-id="week-card"]')).toContainText(
      "마인크래프트 — 건축 계속",
    );

    await expect(page.locator('[data-od-id="schedule-editor"]')).toHaveScreenshot(
      `schedule-editor-${theme}.png`,
      { animations: "disabled" },
    );
  });
}
