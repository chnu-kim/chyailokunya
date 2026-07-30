/* 팬아트 파일의 규칙(ADR-0028). 무엇을 받아들이고 무엇을 키라고 부르는지가 여기 모여 있다 —
   업로드 라우트·서빙 라우트·저장 Zod 가 전부 이 파일을 읽는다. HTTP·R2·React 를 모르는 순수
   로직이라 workerd 단위 테스트로 못박는다.

   **확장자와 Content-Type 은 클라이언트의 주장이다.** 둘 다 위조되고, 위조된 값을 그대로 믿으면
   우리 origin 에서 우리가 모르는 바이트를 서빙하게 된다. 그래서 판정은 실제 바이트 앞머리의
   시그니처로 한다 — 이건 디코드가 아니라 몇 바이트 비교라 CPU 가 사실상 0 이다(ADR-0028 의
   "요청 경로에서 이미지를 만지지 않는다"). */

/* 받아들이는 형식 셋. 이 배열이 매직 바이트·확장자·Content-Type·화면 accept 속성의 단일
   원천이다. gif·svg 를 안 받는 이유는 서로 다르다: gif 는 팬아트 한 장이라는 쓰임에 없고,
   **svg 는 마크업이라** 우리 origin 에서 서빙되는 순간 스크립트를 실을 수 있는 문서가 된다. */
export const FANART_IMAGE_TYPES = ["png", "jpeg", "webp"] as const;
export type FanartImageType = (typeof FANART_IMAGE_TYPES)[number];

/* 업로드 상한. 팬아트는 화면에서 최대 420px 폭으로 서고 공유 카드에서도 그보다 크게 안 나가므로
   원본 해상도를 그대로 받을 이유가 없다 — 다만 서버 변환을 안 하기로 했으니(ADR-0028) 관리자가
   올리는 원본을 그대로 받는다. 5MB 는 트위터에 올라가는 일러스트 원본이 대체로 들어오는 크기다.

   **줄이는 것보다 늘리는 게 쉽다** — 이미 올라간 객체는 상한을 낮춰도 남으므로 보수적으로 잡는다.
   공유 카드에 싣는 작업(별도 이슈)은 이 값을 다시 봐야 한다: html-to-image 가 이미지를 base64
   dataURL 로 인라인해 문자열이 4/3 배로 부풀고, 그게 캡처의 15초 상한과 같은 예산을 쓴다. */
export const FANART_MAX_BYTES = 5 * 1024 * 1024;

/* 상한 판정. 업로드 라우트가 **두 번** 부른다 — 선언된 Content-Length 로 한 번(바이트를 안
   읽고 즉시 거절), 실제 본문 길이로 한 번(헤더는 클라이언트의 주장이라 그것만 믿으면 상한이
   통째로 뚫린다). 규칙을 여기 한 곳에 두는 이유가 그 둘이 갈리지 않게 하는 것이다.

   `Number.isFinite` 가드가 하는 일: 헤더가 없으면 `Number(null)` 이 0 이라 그냥 통과하고,
   헤더가 숫자가 아니면 NaN 이라 비교가 전부 false 가 된다 — 어느 쪽이든 **판정을 실제 길이
   쪽으로 미룬다**(헤더의 부재·쓰레기가 거절 사유가 되면 안 된다). */
export function isOverFanartLimit(byteLength: number): boolean {
  return Number.isFinite(byteLength) && byteLength > FANART_MAX_BYTES;
}

/* 저장할 수 있는 픽셀 치수의 상한(읽기 화면의 자리 예약, ADR-0028). 저장 Zod 와 **치수를 읽는
   화면**이 같은 값을 봐야 한다 — 갈리면 화면이 읽어 보낸 값이 경계에서 거절돼 **그림 자체를 못
   거는** 상태가 된다(치수는 레이아웃 힌트일 뿐인데 그것 때문에 업로드가 통째로 무의미해진다).
   그래서 상한을 넘는 치수는 화면이 미리 버리고(null = 예약 없이 그린다) 그림만 저장한다.

   20000 은 현실적인 이미지 치수의 위쪽이고, 상한 자체가 필요한 이유는 위조 클라이언트가 거대한
   정수를 보내면 그 값이 그대로 img 속성에 실려 그림 한 장이 화면을 통째로 밀어낸다는 것이다. */
export const FANART_MAX_DIMENSION = 20000;

/* 화면이 읽은 치수를 저장할 수 있는 값으로 정규화한다. 못 읽었거나(null) 범위를 벗어나면 **쌍째로
   버린다** — 한쪽만 남으면 저장 경계가 거절하고(폭과 높이는 함께 보내야 한다) DB CHECK 도 같은
   규칙이라, 반쪽을 만들어 보내는 것보다 없는 게 낫다. 순수 함수라 단위 테스트가 경계값을 본다. */
export function normalizeFanartSize(
  width: number | null | undefined,
  height: number | null | undefined,
): { width: number | null; height: number | null } {
  const ok = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isInteger(v) && v > 0 && v <= FANART_MAX_DIMENSION;
  return ok(width) && ok(height) ? { width, height } : { width: null, height: null };
}

/* 픽셀 예산 — **바이트 상한과 다른 축이다.** 5MB 안에도 수억 픽셀이 들어간다: 단색 20000×20000
   PNG 는 압축 상태로 수 KB 인데 브라우저가 디코드하면 픽셀당 4바이트로 펼쳐져 1.6GB 가 된다.
   그 파일이 발행된 주에 걸리면 **그 주를 여는 모든 방문자의 탭이 죽는다** — 업로드하는 관리자
   탭도 함께 죽는다(치수를 읽는 `createImageBitmap` 자체가 그 비트맵을 할당한다).

   `FANART_MAX_DIMENSION` 과 **함께** 봐야 한다: 한 변 상한만으로는 19000×19000(361MP)이 통과한다.
   40MP 는 실사용 일러스트의 위쪽이다(6000×6000 = 36MP · 트위터 업로드 상한도 이 근처다). */
export const FANART_MAX_PIXELS = 40_000_000;

/* 예산 판정. 곱셈 하나지만 함수로 두는 이유는 라우트와 테스트가 같은 규칙을 보게 하는 것이다 —
   상한을 바꿀 때 두 곳이 갈리지 않는다(isOverFanartLimit 과 같은 자리). */
export function isOverPixelBudget(width: number, height: number): boolean {
  return width * height > FANART_MAX_PIXELS;
}

/* 빅엔디안·리틀엔디안 u16/u24/u32. 형식마다 바이트 순서가 다르다 — PNG/JPEG 는 BE, WebP 는
   RIFF 계열이라 LE 다. 범위를 넘으면 null(호출자가 "못 읽었다"로 다룬다). */
function beU32(b: Uint8Array, at: number): number | null {
  if (b.length < at + 4) return null;
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}
function beU16(b: Uint8Array, at: number): number | null {
  if (b.length < at + 2) return null;
  return (b[at]! << 8) | b[at + 1]!;
}
function leU16(b: Uint8Array, at: number): number | null {
  if (b.length < at + 2) return null;
  return b[at]! | (b[at + 1]! << 8);
}
function leU24(b: Uint8Array, at: number): number | null {
  if (b.length < at + 3) return null;
  return b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
}

/* PNG: 시그니처 8 + 청크 길이 4 + "IHDR" 4 뒤에 폭·높이가 BE u32 로 온다(규격이 IHDR 을 **첫
   청크로 못박았다**). 고정 오프셋이라 스캔이 없다. */
function pngSize(b: Uint8Array) {
  const width = beU32(b, 16);
  const height = beU32(b, 20);
  return width !== null && height !== null ? { width, height } : null;
}

/* JPEG: 세그먼트를 훑어 SOF(Start Of Frame) 를 찾는다. 마커는 `FF xx` 이고 대부분 뒤에 길이
   u16(자기 포함)이 붙는데, SOI·EOI·RST·TEM 은 **길이가 없어** 건너뛰는 방식이 다르다.
   SOF 페이로드: 길이(2) + 정밀도(1) + 높이(2) + 폭(2) — 높이가 먼저다.

   **점프 횟수에 상한을 둔다.** 길이 0·1 같은 값을 넣으면 오프셋이 안 늘어 무한 루프가 되고,
   악성 파일이 그걸 만들 수 있다(요청 경로에서 도는 코드라 그 자체가 CPU 공격이 된다).
   정상 JPEG 의 SOF 는 앞쪽 몇 개 세그먼트 안에 오므로 넉넉히 잡아도 64 로 충분하다. */
const JPEG_MAX_SEGMENTS = 64;
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
function jpegSize(b: Uint8Array) {
  let at = 2; // FF D8(SOI) 다음
  for (let hops = 0; hops < JPEG_MAX_SEGMENTS; hops++) {
    // 마커는 FF 로 시작한다. 패딩 FF 가 여러 개 올 수 있어 건너뛴다.
    while (at < b.length && b[at] === 0xff) at++;
    if (at >= b.length) return null;
    const marker = b[at]!;
    at++;
    // 길이 없는 마커: RST0~7(D0-D7) · SOI(D8) · EOI(D9) · TEM(01).
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) continue;
    const len = beU16(b, at);
    if (len === null || len < 2) return null; // 길이가 자기(2)보다 작으면 깨진 파일이다
    if (SOF_MARKERS.has(marker)) {
      const height = beU16(b, at + 3);
      const width = beU16(b, at + 5);
      return width !== null && height !== null ? { width, height } : null;
    }
    at += len;
  }
  return null;
}

/* WebP: RIFF 컨테이너라 LE 다. 청크 fourcc(offset 12)에 따라 치수 자리가 셋으로 갈린다 —
   **하나만 파싱하면 정상 파일의 2/3 를 거절한다.**
     VP8  (lossy)    — 청크 데이터 + 6 부터 14비트 폭·높이(상위 2비트는 스케일)
     VP8L (lossless) — 청크 데이터 + 1 부터 28비트에 (폭-1, 높이-1) 각 14비트
     VP8X (extended) — 청크 데이터 + 4 부터 24비트 (캔버스 폭-1, 높이-1) */
function webpSize(b: Uint8Array) {
  const fourcc = String.fromCharCode(...b.slice(12, 16));
  if (fourcc === "VP8 ") {
    const w = leU16(b, 26);
    const h = leU16(b, 28);
    // 상위 2비트는 스케일 힌트라 치수에서 뺀다(14비트 폭·높이).
    return w !== null && h !== null ? { width: w & 0x3fff, height: h & 0x3fff } : null;
  }
  if (fourcc === "VP8L") {
    if (b.length < 25) return null;
    const bits = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    const w = leU24(b, 24);
    const h = leU24(b, 27);
    return w !== null && h !== null ? { width: w + 1, height: h + 1 } : null;
  }
  return null;
}

/* 형식 헤더에서 픽셀 치수를 읽는다 — **디코드가 아니다.** 규격이 파일 앞머리에 못박은 정수를
   몇 개 읽는 것이라 CPU 가 매직 바이트 판정과 같은 급이고, ADR-0028 의 "요청 경로에서 이미지를
   만지지 않는다"와 충돌하지 않는다(그 결정이 막은 것은 디코드·재인코딩이다).

   **못 읽으면 null 이고, 라우트는 그걸 거절로 다룬다**(fail-closed). 이 판정은 치수 힌트
   (ADR-0030 의 fail-open)와 **다른 결정이다** — 여기서 통과시키면 폭탄 방어에 우회로가 생기고,
   반대로 못 읽는 파일은 브라우저도 디코드 못 할 가능성이 높아 통과시켜도 그림이 안 뜬다.
   매직 바이트를 이미 지난 파일이므로 "그 형식이라고 주장하는데 헤더가 규격과 다르다"는 뜻이다. */
export function readImageDimensions(
  bytes: Uint8Array,
  type: FanartImageType,
): { width: number; height: number } | null {
  const size =
    type === "png" ? pngSize(bytes) : type === "jpeg" ? jpegSize(bytes) : webpSize(bytes);
  // 0 이나 음수는 치수가 아니다 — 그런 헤더는 깨진 파일이고, 곱셈이 예산 판정을 우회한다.
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}

const CONTENT_TYPES: Record<FanartImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function fanartContentType(type: FanartImageType): string {
  return CONTENT_TYPES[type];
}

/* 파일 시그니처. 앞 12바이트만 본다.
     PNG  — 89 50 4E 47 0D 0A 1A 0A (8바이트 고정)
     JPEG — FF D8 FF (SOI + 첫 마커. 네 번째 바이트는 세그먼트마다 달라 안 본다)
     WebP — RIFF ???? WEBP (4~7바이트는 파일 크기라 건너뛴다)
   전부 규격이 파일 맨 앞에 못박은 값이라, 이걸 통과했다는 건 "그 형식의 파일로 시작한다"는
   뜻이다. 파일 전체가 유효한 이미지인지까지는 보증하지 않는다 — 그건 디코드가 필요하고, 그
   CPU 를 안 쓰기로 한 것이 이 설계의 전제다(ADR-0028). 깨진 이미지는 브라우저가 안 그릴 뿐
   우리 쪽에 위험이 없다. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/* 길이를 먼저 본다. 없어도 결과는 같지만(범위 밖 인덱스는 undefined 라 `===` 가 false 를 낸다,
   실측) 그건 우연히 맞는 것이지 적어 둔 계약이 아니다 — 빈 버퍼·잘린 조각을 거절한다는 사실이
   코드에 보여야 다음 사람이 비교문을 바꿀 때 이 자리를 안 무너뜨린다. */
function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/* 바이트 앞머리로 형식을 판정한다 — 모르는 형식이면 null(호출자가 거절한다). */
export function sniffImageType(bytes: Uint8Array): FanartImageType | null {
  if (startsWith(bytes, PNG)) return "png";
  if (startsWith(bytes, JPEG)) return "jpeg";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "webp";
  return null;
}

/* 저장되는 키. `<uuid>.<ext>` 한 조각이고 R2 prefix 와 서빙 경로는 아래 두 함수가 붙인다.

   **DB 가 경로도 호스트도 모르게 한다**(ADR-0028): 컬럼이 URL 이면 외부 호스트를 가리키는 행을
   막을 문법적 수단이 없고, 경로까지 담으면 라우트를 옮길 때 모든 행을 고쳐야 한다. 조각 하나면
   아래 정규식이 통째로 검증하고 `..`·`/` 가 애초에 못 들어가 경로 순회가 성립하지 않는다. */
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export function isFanartKey(value: string): boolean {
  return KEY_RE.test(value);
}

/* 확장자는 판정된 형식에서 나온다 — 업로드된 파일명을 안 쓴다(그것도 클라이언트의 주장이다).
   jpeg 를 `.jpg` 로 적는 건 관행이라 그대로 따른다(형식 이름과 확장자가 갈리는 유일한 자리). */
const EXTENSIONS: Record<FanartImageType, string> = { png: "png", jpeg: "jpg", webp: "webp" };

export function fanartKey(type: FanartImageType, uuid: string): string {
  return `${uuid}.${EXTENSIONS[type]}`;
}

/* R2 객체 키. prefix 를 코드가 붙여 버킷 안에서 팬아트가 한 자리에 모인다 — 나중에 다른 종류의
   바이트가 같은 버킷에 들어와도 목록·정리가 갈린다. 호출 전에 isFanartKey 로 거른다. */
export function fanartObjectKey(key: string): string {
  return `fanart/${key}`;
}

/* 엣지 캐시 키. **쿼리스트링을 떼어 낸다.**

   Cache API 는 요청 URL 전체를 키로 쓰는데 우리 R2 조회는 경로의 key 만 본다 — 그대로 두면
   `/api/fanart/<키>?n=1`, `?n=2` … 가 전부 캐시 미스가 되면서 **같은 객체를 매번 다시 읽는다.**
   인증이 없는 공개 경로라 누구나 그 증폭을 만들 수 있다(적대적 리뷰 지적). 응답이 쿼리에
   따라 달라질 여지가 애초에 없으므로, 키에서 지우는 것이 정확한 표현이기도 하다.

   순수 함수로 둔 이유: 이 규칙을 e2e 가 못 본다 — `next dev` 는 Node 라 `caches` 자체가 없어
   프로덕션 캐시 키 동작을 재현하지 않는다. 규칙만이라도 단위 테스트가 못박는다. */
export function fanartCacheKey(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}${url.pathname}`;
}
