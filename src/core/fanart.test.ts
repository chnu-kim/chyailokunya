import { describe, expect, it } from "vitest";
import {
  FANART_MAX_BYTES,
  FANART_MAX_DIMENSION,
  fanartCacheKey,
  fanartContentType,
  fanartKey,
  fanartObjectKey,
  isFanartKey,
  isOverFanartLimit,
  normalizeFanartSize,
  sniffImageType,
} from "./fanart";

// 각 형식의 실제 파일 앞머리. 뒤에 붙는 바이트는 판정에 안 쓰이므로 0 으로 채운다.
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const webp = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const UUID = "0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f";

describe("sniffImageType", () => {
  it("PNG·JPEG·WebP 를 시그니처로 알아본다", () => {
    expect(sniffImageType(png())).toBe("png");
    expect(sniffImageType(jpeg())).toBe("jpeg");
    expect(sniffImageType(webp())).toBe("webp");
  });

  it("모르는 형식은 null 이다 — 확장자·Content-Type 이 뭐라 하든 바이트가 정본이다", () => {
    // GIF89a. 파일명이 .png 이고 Content-Type 이 image/png 라 해도 여기서 걸린다.
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    // SVG(마크업). 우리 origin 에서 서빙되면 스크립트를 실을 수 있는 문서라 특히 막아야 한다.
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(sniffImageType(new Uint8Array(12))).toBeNull();
  });

  it("앞머리가 잘린 버퍼를 시그니처로 오인하지 않는다", () => {
    // PNG 시그니처의 앞 4바이트만 있는 조각. 빈 요청 본문이 형식으로 통과하면 안 된다.
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it("RIFF 로 시작하지만 WEBP 가 아닌 컨테이너를 거절한다", () => {
    // RIFF....AVI  — 앞 4바이트만 보면 통과하므로 8번째부터의 형식 태그까지 봐야 한다.
    const avi = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
    expect(sniffImageType(avi)).toBeNull();
  });
});

describe("키 형식", () => {
  it("uuid + 허용 확장자만 키로 인정한다", () => {
    expect(isFanartKey(`${UUID}.png`)).toBe(true);
    expect(isFanartKey(`${UUID}.jpg`)).toBe(true);
    expect(isFanartKey(`${UUID}.webp`)).toBe(true);
  });

  it("경로가 섞인 값을 거절한다 — 서빙 라우트가 이 판정 하나로 순회를 막는다", () => {
    expect(isFanartKey(`../${UUID}.png`)).toBe(false);
    expect(isFanartKey(`fanart/${UUID}.png`)).toBe(false);
    expect(isFanartKey("../../drizzle/0001_dry_shaman.sql")).toBe(false);
    /* 개행을 낀 값. JS 의 `$` 는 multiline 이 아니면 입력 끝에만 매치해 이미 안전하지만
       (Python 의 `$` 와 다른 자리 — 실측), 다음 사람이 플래그를 더할 때 이 줄이 빨개진다. */
    expect(isFanartKey(`${UUID}.png\n../etc`)).toBe(false);
    expect(isFanartKey(`${UUID}.png\n`)).toBe(false);
  });

  it("모양이 다른 값을 거절한다", () => {
    expect(isFanartKey(`${UUID}.svg`)).toBe(false);
    expect(isFanartKey(`${UUID}.jpeg`)).toBe(false); // 저장 확장자는 .jpg 다
    expect(isFanartKey(UUID)).toBe(false);
    expect(isFanartKey(`${UUID.toUpperCase()}.png`)).toBe(false);
    expect(isFanartKey("")).toBe(false);
  });

  it("확장자는 판정된 형식에서 나온다 — jpeg 는 .jpg 로 적는다", () => {
    expect(fanartKey("png", UUID)).toBe(`${UUID}.png`);
    expect(fanartKey("jpeg", UUID)).toBe(`${UUID}.jpg`);
    expect(fanartKey("webp", UUID)).toBe(`${UUID}.webp`);
  });

  it("만들어 낸 키는 스스로의 검증을 통과한다", () => {
    for (const type of ["png", "jpeg", "webp"] as const) {
      expect(isFanartKey(fanartKey(type, UUID))).toBe(true);
    }
  });

  it("R2 객체 키는 prefix 를 붙인다", () => {
    expect(fanartObjectKey(`${UUID}.png`)).toBe(`fanart/${UUID}.png`);
  });
});

describe("fanartCacheKey", () => {
  /* **e2e 가 못 보는 규칙이다** — `next dev` 는 Node 라 `caches` 자체가 없어 프로덕션 캐시 키
     동작을 재현하지 않는다(그래서 이 결함이 게이트 전부 초록인 채 살아 있었다). */
  const base = `https://chyailokunya.com/api/fanart/${UUID}.png`;

  it("쿼리스트링이 뭐든 같은 키가 된다 — 공개 URL 이 R2 재읽기로 증폭되지 않는다", () => {
    expect(fanartCacheKey(base)).toBe(base);
    expect(fanartCacheKey(`${base}?n=1`)).toBe(base);
    expect(fanartCacheKey(`${base}?n=2&x=y`)).toBe(base);
    // 캐시를 우회하려는 임의 파라미터 100개가 전부 같은 엔트리로 접힌다.
    const keys = new Set(
      Array.from({ length: 100 }, (_, i) => fanartCacheKey(`${base}?bust=${i}`)),
    );
    expect(keys.size).toBe(1);
  });

  it("경로가 다르면 키도 다르다 — 서로 다른 그림이 한 엔트리를 공유하지 않는다", () => {
    const other = `https://chyailokunya.com/api/fanart/${UUID}.webp`;
    expect(fanartCacheKey(other)).not.toBe(fanartCacheKey(base));
  });

  it("origin 을 유지한다 — 키가 호스트를 잃으면 환경 간 캐시가 섞인다", () => {
    expect(fanartCacheKey(`http://localhost:3100/api/fanart/${UUID}.png?n=1`)).toBe(
      `http://localhost:3100/api/fanart/${UUID}.png`,
    );
  });
});

describe("상수", () => {
  it("Content-Type 은 판정된 형식에서 나온다", () => {
    expect(fanartContentType("png")).toBe("image/png");
    expect(fanartContentType("jpeg")).toBe("image/jpeg");
    expect(fanartContentType("webp")).toBe("image/webp");
  });

  it("업로드 상한은 5MB 다", () => {
    expect(FANART_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("isOverFanartLimit", () => {
  /* 라우트가 이 판정을 두 번 쓴다(선언된 Content-Length · 실제 본문 길이). 경계를 여기서
     못박는 이유: e2e 로 재려면 5MB 본문을 실제로 전송해야 하는데, 그러면 `next dev` 서버가
     그 요청에 묶여 **무관한 스펙들이 줄줄이 타임아웃된다**(실측: 전체 e2e 2.7분·5개 실패 →
     그 테스트 하나를 빼면 1.2분·전부 통과). Content-Length 만 크게 위조해 싸게 재려 해도
     통하지 않는다 — Playwright 가 실제 본문 길이로 덮어쓴다(실측: 201). */
  it("상한 이하는 통과하고 한 바이트만 넘어도 거절한다", () => {
    expect(isOverFanartLimit(FANART_MAX_BYTES)).toBe(false); // 정확히 상한은 허용
    expect(isOverFanartLimit(FANART_MAX_BYTES + 1)).toBe(true);
    expect(isOverFanartLimit(1)).toBe(false);
  });

  it("헤더가 없거나 숫자가 아니면 판정을 실제 길이로 미룬다", () => {
    // Number(null) === 0 — 헤더 부재가 거절 사유가 되면 안 된다.
    expect(isOverFanartLimit(Number(null))).toBe(false);
    // Number("abc") === NaN — 쓰레기 헤더도 마찬가지다(실제 길이 검사가 뒤에서 잡는다).
    expect(isOverFanartLimit(Number("abc"))).toBe(false);
    expect(isOverFanartLimit(Number(undefined))).toBe(false);
    /* Infinity 도 여기서 안 걸린다 — 유한하지 않으면 헤더를 못 믿는 것으로 보고 미룬다.
       거절은 아래(실제 본문 길이)에서 나므로 이 값으로 상한을 우회할 수는 없다. */
    expect(isOverFanartLimit(Infinity)).toBe(false);
  });
});

describe("normalizeFanartSize", () => {
  /* 치수는 **레이아웃 힌트라 fail-open** 이다(ADR-0028·db/schema.ts). 그래서 이 함수의 일은
     "믿을 수 없는 값을 거절하는 것"이 아니라 **저장할 수 있는 쌍만 통과시키고 나머지는 쌍째로
     버리는 것**이다 — 반쪽을 보내면 저장 경계가 그림까지 거절해, 힌트 하나 때문에 업로드가
     통째로 무의미해진다. 화면이 못 읽는 경우(디코드 실패)와 상한 초과가 같은 결과로 접힌다. */
  it("온전한 쌍만 통과한다", () => {
    expect(normalizeFanartSize(1200, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(normalizeFanartSize(1, 1)).toEqual({ width: 1, height: 1 });
    expect(normalizeFanartSize(FANART_MAX_DIMENSION, FANART_MAX_DIMENSION)).toEqual({
      width: FANART_MAX_DIMENSION,
      height: FANART_MAX_DIMENSION,
    });
  });

  it("한쪽이라도 못 쓰는 값이면 쌍째로 버린다", () => {
    // 상한을 **넘으면 그림을 못 거는 게 아니라 예약을 포기한다** — 저장 Zod 와 같은 값을 본다.
    expect(normalizeFanartSize(FANART_MAX_DIMENSION + 1, 600)).toEqual({
      width: null,
      height: null,
    });
    expect(normalizeFanartSize(800, 0)).toEqual({ width: null, height: null });
    expect(normalizeFanartSize(-1, 600)).toEqual({ width: null, height: null });
    // 디코드 실패(둘 다 null)와 반쪽만 읽힌 경우가 같은 결과로 접힌다.
    expect(normalizeFanartSize(null, null)).toEqual({ width: null, height: null });
    expect(normalizeFanartSize(800, null)).toEqual({ width: null, height: null });
    expect(normalizeFanartSize(undefined, undefined)).toEqual({ width: null, height: null });
    // 소수·NaN 은 정수가 아니다(브라우저는 정수를 주지만 계약을 코드에 적어 둔다).
    expect(normalizeFanartSize(800.5, 600)).toEqual({ width: null, height: null });
    expect(normalizeFanartSize(NaN, 600)).toEqual({ width: null, height: null });
  });
});
