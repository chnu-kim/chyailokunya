import { describe, expect, it } from "vitest";
import { rejectCrossSiteFetch, rejectForeignOrigin, requireAuthOrigin } from "./request-guard";

const AUTH_URL = "https://chyailokunya.com";

function req(headers: Record<string, string> = {}) {
  return new Request("https://chyailokunya.com/api/x", { headers });
}

describe("requireAuthOrigin — AUTH_URL fail-closed", () => {
  it("부재면 503(Host 폴백 금지 — 리다이렉트 대상 조작 경로를 끊는다)", async () => {
    const out = requireAuthOrigin({});
    expect(out).toBeInstanceOf(Response);
    const res = out as Response;
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("AUTH_URL 미설정");
  });

  it("있으면 검증된 origin 을 그대로 돌려준다", () => {
    expect(requireAuthOrigin({ AUTH_URL })).toEqual({ origin: AUTH_URL });
  });
});

describe("rejectForeignOrigin — Origin 대조(CSRF)", () => {
  it("일치하면 통과(null)", () => {
    expect(rejectForeignOrigin(req({ origin: AUTH_URL }), AUTH_URL)).toBeNull();
  });

  it("다른 origin·헤더 부재·기대값 부재·쓰레기 값 전부 403 fail-closed", async () => {
    const cases = [
      rejectForeignOrigin(req({ origin: "https://evil.example" }), AUTH_URL),
      rejectForeignOrigin(req(), AUTH_URL), // 브라우저는 상태 변경 요청에 Origin 을 싣는다 — 없으면 거절
      rejectForeignOrigin(req({ origin: AUTH_URL }), undefined), // AUTH_URL 오설정도 fail-closed
      rejectForeignOrigin(req({ origin: "not-a-url" }), AUTH_URL),
    ];
    for (const denied of cases) {
      expect(denied).toBeInstanceOf(Response);
      expect(denied!.status).toBe(403);
      expect(await denied!.clone().text()).toBe("forbidden origin");
    }
  });

  it("site 가 아니라 origin 단위로 대조한다(서브도메인 거절 — Lax 의 구멍을 안 물려받는다)", () => {
    expect(
      rejectForeignOrigin(req({ origin: "https://www.chyailokunya.com" }), AUTH_URL),
    ).toBeInstanceOf(Response);
  });
});

describe("rejectCrossSiteFetch — Sec-Fetch-Site(GET 표면)", () => {
  it("cross-site 만 403 — same-origin·same-site·none·헤더 없음(옛 브라우저)은 통과", async () => {
    const denied = rejectCrossSiteFetch(req({ "sec-fetch-site": "cross-site" }));
    expect(denied).toBeInstanceOf(Response);
    expect(denied!.status).toBe(403);
    expect(await denied!.text()).toBe("forbidden origin");

    for (const value of ["same-origin", "same-site", "none"]) {
      expect(rejectCrossSiteFetch(req({ "sec-fetch-site": value }))).toBeNull();
    }
    expect(rejectCrossSiteFetch(req())).toBeNull();
  });
});
