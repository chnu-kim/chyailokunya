/* 로그인 시작 라우트의 계약(ADR-0017). 이 파일이 생기기 전 이 라우트는 **어느 층도 안 봤다** —
   e2e 는 치지직 OAuth 를 안 태우고 access 쿠키를 직접 서명하므로(ADR-0021) 여기를 지나가지
   않는다. 커버리지를 처음 재고 나서야 드러난 자리다(ADR-0029).

   **`getCloudflareContext` 를 목으로 바꾼다.** app 레이어 라우트는 요청 스코프 바인딩을 그걸로
   꺼내는데, 워커 풀 테스트엔 그 컨텍스트를 세우는 요청 경계가 없다. `vi.hoisted` 로 만든
   가변 상자를 목이 읽게 해서 테스트마다 env 를 갈아 끼운다(팩토리는 hoist 되므로 바깥 변수를
   직접 못 읽는다). */

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@/features/auth/config";

const { ctx } = vi.hoisted(() => ({ ctx: { env: {} as Record<string, unknown> } }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: ctx.env }),
}));

const { GET } = await import("./route");

const AUTH_URL = "https://chyailokunya.com";

beforeEach(() => {
  ctx.env = { ...env, CHZZK_CLIENT_ID: "client-abc", AUTH_URL };
});

// 응답의 Set-Cookie 를 이름으로 찾는다. 한 응답에 여러 줄이 실리므로 getSetCookie 로 전부 본다.
function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

describe("GET /api/auth/login", () => {
  it("설정이 없으면 503 — Host 헤더로 폴백하지 않는다(fail-closed)", async () => {
    for (const missing of [{ CHZZK_CLIENT_ID: undefined }, { AUTH_URL: undefined }]) {
      ctx.env = { ...env, CHZZK_CLIENT_ID: "client-abc", AUTH_URL, ...missing };
      const res = await GET(new Request("https://chyailokunya.com/api/auth/login"));
      expect(res.status).toBe(503);
    }
  });

  it("치지직 동의 화면으로 302 — redirectUri 는 콘솔 등록값과 같은 고정 경로다", async () => {
    const res = await GET(new Request("https://chyailokunya.com/api/auth/login"));

    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://chzzk.naver.com/account-interlock");
    expect(to.searchParams.get("clientId")).toBe("client-abc");
    /* 불변식 10 — 이 경로가 치지직 콘솔 등록값과 한 글자라도 다르면 동의 화면이 403 이다.
       AUTH_URL 은 origin 만 담고 경로는 코드가 조립한다는 계약을 여기서 못박는다. */
    expect(to.searchParams.get("redirectUri")).toBe(`${AUTH_URL}/api/auth/callback/chzzk`);
  });

  it("state 를 쿠키와 쿼리에 같은 값으로 심는다 — 이중 제출이 위조 콜백을 막는다", async () => {
    const res = await GET(new Request("https://chyailokunya.com/api/auth/login"));

    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    expect(state).toHaveLength(36); // crypto.randomUUID
    const cookie = setCookie(res, COOKIE_NAME.state)!;
    expect(cookie).toContain(state);
    // httpOnly 라야 공격자가 쿠키 쪽을 못 심는다 — 이중 제출의 전제다.
    expect(cookie.toLowerCase()).toContain("httponly");
    /* `__Host-` 프리픽스는 이름이 아니라 **보안 계약**이다 — 브라우저가 이 이름을 보면
       Secure·Path=/·Domain 미지정을 강제해, 하위 도메인이 이 쿠키를 심거나 덮지 못한다.
       상수를 갈아 끼워 프리픽스를 잃는 변경이 조용히 통과하면 안 되므로 여기서 리터럴로 본다. */
    expect(COOKIE_NAME.state.startsWith("__Host-")).toBe(true);
  });

  it("return_to 는 검증해서 심는다 — 허용목록 밖은 조용히 `/`", async () => {
    const res = await GET(
      new Request("https://chyailokunya.com/api/auth/login?return_to=https://evil.example/x"),
    );
    expect(setCookie(res, COOKIE_NAME.returnTo)).toContain(`${COOKIE_NAME.returnTo}=%2F;`);
  });

  it("허용목록 안 경로는 그대로 심는다", async () => {
    const res = await GET(
      new Request("https://chyailokunya.com/api/auth/login?return_to=%2Fgames"),
    );
    expect(setCookie(res, COOKIE_NAME.returnTo)).toContain("%2Fgames");
  });

  /* 조건부로 심으면 이런 일이 난다: /games 에서 눌러 쿠키가 심긴 뒤 동의 화면에서 이탈 →
     쿠키는 10분 산다 → / 로 돌아와 다시 누름 → 안 심으면 쿠키가 여전히 /games → 누른 적 없는
     /games 로 착지한다. 매 로그인이 이전 시도의 잔여를 덮는 것이 이 쿠키의 계약이다. */
  it("return_to 가 없어도 반드시 덮어쓴다 — 이전 시도의 잔여가 다음 로그인을 끌고 가지 않게", async () => {
    const res = await GET(new Request("https://chyailokunya.com/api/auth/login"));
    expect(setCookie(res, COOKIE_NAME.returnTo)).toBeDefined();
  });
});
