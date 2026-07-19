import { exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { sessionKeys, verificationKeys } from "./keys";

let publicJson: string;
let signingJson: string;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
  publicJson = JSON.stringify(await exportJWK(publicKey));
  signingJson = JSON.stringify(await exportJWK(privateKey));
});

describe("sessionKeys — 짝 fail-closed", () => {
  it("둘 다 있어야 세션 키가 성립한다 — 한쪽만 있으면 null(오설정, 세션 기능 끔)", () => {
    expect(sessionKeys({})).toBeNull();
    expect(sessionKeys({ JWT_PUBLIC_JWK: publicJson })).toBeNull();
    expect(sessionKeys({ JWT_SIGNING_JWK: signingJson })).toBeNull();
    expect(
      sessionKeys({ JWT_PUBLIC_JWK: publicJson, JWT_SIGNING_JWK: signingJson }),
    ).not.toBeNull();
  });

  it("게터가 각각 검증 키 목록·서명 키를 파싱해 돌려준다", () => {
    const keys = sessionKeys({ JWT_PUBLIC_JWK: publicJson, JWT_SIGNING_JWK: signingJson })!;
    expect(keys.verificationKeys()).toEqual([JSON.parse(publicJson)]);
    expect(keys.signingKey()).toEqual(JSON.parse(signingJson));
  });

  it("파싱은 게터 호출 시점까지 지연된다 — 짝 확인만으로는 깨진 JSON 이 안 터진다", () => {
    const keys = sessionKeys({ JWT_PUBLIC_JWK: publicJson, JWT_SIGNING_JWK: "{broken" });
    expect(keys).not.toBeNull();
    expect(() => keys!.verificationKeys()).not.toThrow();
    // 설정 오류는 삼키지 않고 라벨을 달아 throw — 부팅 즉시 드러나야 한다.
    expect(() => keys!.signingKey()).toThrow(/JWT_SIGNING_JWK 파싱 실패/);
  });

  it("깨진 공개키 JSON 도 라벨을 달아 throw", () => {
    const keys = sessionKeys({ JWT_PUBLIC_JWK: "42", JWT_SIGNING_JWK: signingJson })!;
    expect(() => keys.verificationKeys()).toThrow(/JWT_PUBLIC_JWK 파싱 실패/);
  });
});

describe("verificationKeys — 읽기 경로는 공개키만 요구", () => {
  it("공개키만 있으면 성립(서명키 불요), 부재면 null(비로그인)", () => {
    expect(verificationKeys({ JWT_PUBLIC_JWK: publicJson })).toEqual([JSON.parse(publicJson)]);
    expect(verificationKeys({})).toBeNull();
  });

  it("같은 JSON 이면 같은 객체를 돌려준다 — jose 의 CryptoKey 캐시(객체 정체성)가 적중해야 한다", () => {
    const [a] = verificationKeys({ JWT_PUBLIC_JWK: publicJson })!;
    const [b] = verificationKeys({ JWT_PUBLIC_JWK: publicJson })!;
    expect(a).toBe(b);
  });
});
