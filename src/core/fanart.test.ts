import { describe, expect, it } from "vitest";
import {
  FANART_MAX_BYTES,
  fanartContentType,
  fanartKey,
  fanartObjectKey,
  isFanartKey,
  isOverFanartLimit,
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
