/* tRPC HTTP 경계의 계약(ADR-0017). 커버리지 0 이었다 — 라우터 프로시저 자체는 각 feature 의
   `router.test.ts` 가 caller 로 촘촘히 보지만, **그 앞에 선 두 가드는 caller 를 우회한다.**
   caller 는 HTTP 를 안 타므로 Sec-Fetch-Site·Origin 검사를 지나가지 않는다.

   즉 이 파일이 없으면 "CSRF 가드를 통째로 지워도 게이트가 전부 초록"이다.

   (주의: 이 주석에 `features` 아래 glob 을 적었다가 파일이 통째로 안 열렸다 — 블록 주석 안의
   `**` + `/` 가 주석 종료로 읽혀 뒤가 코드로 파싱된다. 오류는 한참 뒤 줄을 가리켜 원인이
   안 보인다. 블록 주석엔 그 조합을 쓰지 않는다.) */

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ctx, jar } = vi.hoisted(() => ({
  ctx: { env: {} as Record<string, unknown> },
  jar: { cookies: new Map<string, string>() },
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: ctx.env }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.cookies.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
}));

const { GET, POST } = await import("./route");

const AUTH_URL = "https://chyailokunya.com";

beforeEach(() => {
  ctx.env = { ...env, AUTH_URL };
  jar.cookies = new Map();
});

function url(path: string): string {
  return `${AUTH_URL}/api/trpc/${path}`;
}

describe("tRPC 경계 — 크로스사이트 차단", () => {
  /* GET 은 뮤테이션을 못 태우지만(allowMethodOverride=false) 쿠키를 업고 인가된 쿼리를
     크로스사이트에서 트리거할 수 있다 — 응답은 SOP 로 못 읽어도 부수효과와 외부 API 쿼터
     (치지직 카테고리 검색)는 남는다. Origin 으로는 못 막는다(same-origin GET 엔 안 실린다). */
  it("GET 도 막는다 — Sec-Fetch-Site 가 cross-site 면 403", async () => {
    const res = await GET(
      new Request(url("games.list"), { headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(res.status).toBe(403);
  });

  it("POST 도 같은 가드를 먼저 지난다", async () => {
    const res = await POST(
      new Request(url("games.add"), {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site", origin: AUTH_URL },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("same-origin·same-site 표기는 통과시킨다", async () => {
    for (const site of ["same-origin", "same-site", "none"]) {
      const res = await GET(
        new Request(url("games.list"), { headers: { "sec-fetch-site": site } }),
      );
      expect(res.status).not.toBe(403);
    }
  });
});

describe("tRPC 경계 — 쓰기 Origin 검증(CSRF)", () => {
  it("Origin 이 없거나 남의 것이면 403 — 프로시저에 닿기 전에 끊는다", async () => {
    const cases: Record<string, string>[] = [{}, { origin: "https://evil.example" }];
    for (const headers of cases) {
      const res = await POST(new Request(url("games.add"), { method: "POST", headers }));
      expect(res.status).toBe(403);
    }
  });

  /* AUTH_URL 오설정도 403 이다(fail-closed) — 기대 origin 을 모르면 쓰기를 받지 않는다.
     여기가 열리면 배포 중 시크릿 누락이 곧 CSRF 구멍이 된다. */
  it("AUTH_URL 이 없으면 Origin 이 맞아도 403", async () => {
    ctx.env = { ...env, AUTH_URL: undefined };
    const res = await POST(
      new Request(url("games.add"), { method: "POST", headers: { origin: AUTH_URL } }),
    );
    expect(res.status).toBe(403);
  });

  // 읽기(GET)는 Origin 을 요구하지 않는다 — 브라우저가 same-origin GET 에 안 실어 주기 때문이다.
  it("GET 은 Origin 없이도 통과한다 — 공개 읽기가 막히면 안 된다", async () => {
    const res = await GET(new Request(url("games.list")));
    expect(res.status).toBe(200);
  });
});

describe("tRPC 경계 — 컨텍스트", () => {
  it("비로그인 공개 읽기가 200 으로 돈다 — DB 바인딩이 컨텍스트에 실린다", async () => {
    const res = await GET(new Request(url("games.list")));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: unknown[] } };
    expect(Array.isArray(body.result.data)).toBe(true);
  });

  /* 가드를 통과해도(Origin 이 우리 것) 인가에서 막힌다 — 서버가 정본이다(불변식 3).
     코드는 UNAUTHORIZED 가 아니라 **FORBIDDEN** 이다: 로그인 여부와 권한 부족을 한 코드로
     묶어 "그 계정이 존재하는가"를 응답으로 흘리지 않는다(라우트 주석이 정본). */
  it("로그인 안 한 쓰기는 FORBIDDEN — 인증 여부를 코드로 흘리지 않는다", async () => {
    const res = await POST(
      new Request(url("games.add"), {
        method: "POST",
        headers: { origin: AUTH_URL, "content-type": "application/json" },
        body: JSON.stringify({ categoryId: "c1", categoryType: "GAME", categoryValue: "게임" }),
      }),
    );

    // tRPC 는 에러도 HTTP 로 감싼다 — 코드로 판정한다.
    const body = (await res.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("FORBIDDEN");
  });
});
