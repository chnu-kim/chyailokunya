import { describe, expect, it } from "vitest";
import {
  FANART_MAX_BYTES,
  FANART_MAX_DIMENSION,
  FANART_MAX_PIXELS,
  fanartCacheKey,
  fanartContentType,
  fanartKey,
  fanartObjectKey,
  isFanartKey,
  isOverFanartLimit,
  isFanartSizeAcceptable,
  readImageDimensions,
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

/* 형식별 헤더 픽스처를 손으로 조립한다 — 규격이 앞머리에 못박은 정수를 읽는 것이므로 **헤더만
   정확하면 충분하다.** 실제 폭탄 파일도 이 헤더를 갖는다(그래서 수 KB 로 수억 픽셀을 주장할 수
   있다) — 거대한 픽셀 데이터를 만들 필요가 없고, 그게 이 방어가 싼 이유이기도 하다. */
function pngWith(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // 길이 13 + "IHDR"
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/* JPEG: SOI + (선택) 앞선 세그먼트들 + SOF0. 페이로드는 길이(2)·정밀도(1)·**높이**(2)·폭(2)
   순서다 — 높이가 먼저인 것이 흔한 실수 자리라 테스트가 그 순서를 못박는다. */
function jpegWith(width: number, height: number, lead: number[] = []): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff];
  return new Uint8Array([0xff, 0xd8, ...lead, ...sof]);
}

function vp8With(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  b.set([0x9d, 0x01, 0x2a], 23); // sync code
  b[26] = width & 0xff;
  b[27] = (width >> 8) & 0x3f;
  b[28] = height & 0xff;
  b[29] = (height >> 8) & 0x3f;
  return b;
}

function vp8lWith(width: number, height: number): Uint8Array {
  const b = new Uint8Array(25);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  b[20] = 0x2f; // signature
  const bits = (width - 1) | ((height - 1) << 14);
  b[21] = bits & 0xff;
  b[22] = (bits >>> 8) & 0xff;
  b[23] = (bits >>> 16) & 0xff;
  b[24] = (bits >>> 24) & 0xff;
  return b;
}

function vp8xWith(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  b[24] = w & 0xff;
  b[25] = (w >> 8) & 0xff;
  b[26] = (w >> 16) & 0xff;
  b[27] = h & 0xff;
  b[28] = (h >> 8) & 0xff;
  b[29] = (h >> 16) & 0xff;
  return b;
}

describe("readImageDimensions", () => {
  it("PNG IHDR 을 읽는다", () => {
    expect(readImageDimensions(pngWith(1200, 1600), "png")).toEqual({ width: 1200, height: 1600 });
  });

  it("JPEG 은 SOF 를 찾아 읽는다 — 높이가 폭보다 먼저 온다", () => {
    expect(readImageDimensions(jpegWith(800, 600), "jpeg")).toEqual({ width: 800, height: 600 });
    /* SOF 앞에 다른 세그먼트가 있어도 찾아낸다(실제 JPEG 은 APP0/APP1 이 앞선다). 길이 필드는
       자기를 포함하므로 4 = 헤더 2 + 데이터 2. */
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    expect(readImageDimensions(jpegWith(640, 480, app0), "jpeg")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("JPEG 의 무한 점프를 막는다 — 요청 경로에서 도는 코드라 그 자체가 CPU 공격이 된다", () => {
    // 길이 0 은 오프셋을 안 늘린다. 상한이 없으면 여기서 루프가 끝나지 않는다.
    const evil = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xe0, 0x00, 0x00]);
    expect(readImageDimensions(evil, "jpeg")).toBeNull();
  });

  it("WebP 세 변종을 모두 읽는다 — 하나만 파싱하면 정상 파일의 2/3 를 거절한다", () => {
    expect(readImageDimensions(vp8With(300, 400), "webp")).toEqual({ width: 300, height: 400 });
    expect(readImageDimensions(vp8lWith(300, 400), "webp")).toEqual({ width: 300, height: 400 });
    expect(readImageDimensions(vp8xWith(300, 400), "webp")).toEqual({ width: 300, height: 400 });
  });

  it("헤더가 규격과 다르거나 잘렸으면 null — 라우트가 그걸 거절로 다룬다(fail-closed)", () => {
    expect(readImageDimensions(new Uint8Array([0x89, 0x50]), "png")).toBeNull();
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8]), "jpeg")).toBeNull();
    // 모르는 WebP 청크(ALPH 로 시작하는 파일 등).
    const unknown = vp8With(1, 1);
    unknown.set([0x41, 0x4c, 0x50, 0x48], 12);
    expect(readImageDimensions(unknown, "webp")).toBeNull();
    // 0 은 치수가 아니다 — 곱셈이 예산 판정을 우회한다.
    expect(readImageDimensions(pngWith(0, 1000), "png")).toBeNull();
  });
});

describe("isFanartSizeAcceptable", () => {
  /* 업로드 라우트가 이 하나로 판정한다 — **두 상한이 다른 것을 막는다:** 픽셀 예산은 방문자
     브라우저의 디코드 메모리, 한 변 상한은 저장 경계(Zod)가 거는 값이다. 함께 안 보면 계약이
     갈려 "업로드는 성공하고 저장이 죽는" 조합이 생긴다. */
  it("한 변 상한만으로는 못 막는 조합을 픽셀 예산이 잡는다", () => {
    // 19000×19000 = 361MP — 두 변 모두 FANART_MAX_DIMENSION 아래인데 예산을 40배 넘는다.
    expect(19000).toBeLessThan(FANART_MAX_DIMENSION);
    expect(isFanartSizeAcceptable(19000, 19000)).toBe(false);
  });

  it("픽셀 예산만으로는 못 막는 조합을 한 변 상한이 잡는다", () => {
    /* 20001×1 은 2만 화소라 예산을 통과하는데 저장 Zod 가 거절한다 — 여기서 같이 안 보면
       업로드가 통과시킨 그림이 어디에도 못 걸린다(그 상태를 화면은 설명할 수 없다). */
    expect(20001 * 1).toBeLessThan(FANART_MAX_PIXELS);
    expect(isFanartSizeAcceptable(FANART_MAX_DIMENSION + 1, 1)).toBe(false);
    expect(isFanartSizeAcceptable(1, FANART_MAX_DIMENSION + 1)).toBe(false);
  });

  it("실사용 크기는 통과하고 경계는 정확하다", () => {
    expect(isFanartSizeAcceptable(6000, 6000)).toBe(true); // 36MP — 큰 일러스트 원본
    expect(isFanartSizeAcceptable(1200, 1600)).toBe(true);
    expect(isFanartSizeAcceptable(FANART_MAX_DIMENSION, 2000)).toBe(true); // 한 변 정확히 상한
    expect(isFanartSizeAcceptable(FANART_MAX_PIXELS, 1)).toBe(false); // 한 변이 상한을 넘는다
    expect(isFanartSizeAcceptable(8000, 5000)).toBe(true); // 40MP 정확히
    expect(isFanartSizeAcceptable(8000, 5001)).toBe(false);
  });

  it("0·음수·소수는 치수가 아니다 — 곱셈이 예산 판정을 우회한다", () => {
    expect(isFanartSizeAcceptable(0, 1000)).toBe(false);
    expect(isFanartSizeAcceptable(-1, 1000)).toBe(false);
    expect(isFanartSizeAcceptable(800.5, 600)).toBe(false);
    expect(isFanartSizeAcceptable(NaN, 600)).toBe(false);
  });
});
