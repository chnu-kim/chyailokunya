/* 팬아트 서빙(ADR-0028). R2 를 public bucket 으로 열지 않고 이 Worker 라우트가 프록시한다 —
   `*.r2.dev` 를 열면 두 번째 origin 이 생겨 "apex 하나" 원칙(AGENTS)과 부딪히고, 그 주소는 우리
   캐시·헤더 정책 밖에 있다.

   **바이트를 만지지 않는다.** `object.body` 는 ReadableStream 이라 Worker 가 읽지 않고 그대로
   흘린다 — 리사이즈·포맷 변환·디코드가 여기 들어오는 순간 `/api/og/schedule` 이 겪은 CPU 한도
   인시던트(Error 1102)로 돌아간다. 그 라우트를 죽인 건 프록시가 아니라 렌더였고, 그 차이가 이
   설계의 전제다.

   **공개 읽기다 — 발행 여부를 안 본다.** 키가 UUID 라 추측이 성립하지 않고, 초안 주의 키는
   화면 어디에도 안 나간다(읽기 화면은 발행된 주만 그린다). 반대로 여기서 "그 키가 발행된 주에
   걸려 있나"를 DB 로 확인하면 요청마다 왕복이 생기고, 발행 상태가 바뀌는 순간 캐시가 틀리며,
   관리자가 초안을 편집하며 미리 보는 경로도 함께 막힌다. 알고 고른 경계다(ADR-0022 의 발행
   경계는 **일정 내용**에 대한 것이고, 여기서 새는 최대치는 "키를 아는 사람이 그림 한 장을 본다"
   이다).

   Range 요청은 안 다룬다 — 이미지 한 장이라 브라우저가 부분 요청을 하지 않는다. 필요해지면
   R2 get 의 range 옵션으로 연다(ADR-0010 JIT). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { fanartObjectKey, isFanartKey } from "@/core/fanart";

/* 키가 유일해 같은 주소가 다른 내용을 가리키는 일이 없다 — immutable 이 성립한다.
   그런데 **헤더만으로는 Worker 응답이 엣지 캐시에 안 앉는다**(AGENTS 지뢰): Worker 가 zone
   캐시보다 먼저 요청을 받으므로, 직접 `caches.default` 에 넣지 않으면 이 헤더는 브라우저
   캐시에만 통한다. 아래 waitUntil 이 그 자리를 채운다. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  /* 키 형식이 곧 방어선이다(core/fanart.ts) — `<uuid>.<ext>` 만 통과하므로 `..`·`/` 가 애초에
     못 들어와 경로 순회가 성립하지 않는다. 형식이 아니면 R2 를 두드리지도 않는다. */
  if (!isFanartKey(key)) return new Response("not found", { status: 404 });

  const { env, ctx } = getCloudflareContext();
  /* `caches` 는 workerd 전역이라 **`next dev` 에는 없다** — 로컬은 라우트를 Node 런타임에서
     돌리기 때문이다. 무방비로 읽으면 로컬·e2e 가 `ReferenceError: caches is not defined` 로
     500 이 난다(실측). 이 저장소가 반복해 밟은 "로컬과 배포의 런타임 계약이 다르다"의 반대
     방향이다 — 여기선 로컬이 더 좁다. 없으면 캐시 없이 R2 를 매번 읽는다(로컬에선 그게 맞다). */
  const cache = typeof caches === "undefined" ? null : caches.default;
  const hit = await cache?.match(req);
  if (hit) return hit;

  const object = await env.FANART.get(fanartObjectKey(key));
  // 404 는 캐시하지 않는다 — 고아 정리·재업로드가 지나간 뒤에도 "없음"이 1년간 굳으면 안 된다.
  if (!object) return new Response("not found", { status: 404 });

  /* 업로드가 매직 바이트로 판정해 심어 둔 Content-Type 이 여기로 나온다(클라이언트 주장이
     아니다). `writeHttpMetadata(headers)` 를 안 쓰는 이유가 둘이다: (1) `next dev` 는 R2 를
     Miniflare 프록시로 부르는데 `Headers` 인스턴스를 인자로 넘기면 직렬화하지 못해 죽는다
     (실측: `DevalueError: Cannot stringify arbitrary non-POJOs`), (2) 그 메서드는 우리가 심지
     않은 헤더까지 함께 쓰므로 아래 cache-control 과 덮어쓰기 순서에 의존하게 된다. 우리가
     저장한 값은 contentType 하나뿐이라 그것만 읽는 게 계약이 분명하다. */
  const headers = new Headers();
  const contentType = object.httpMetadata?.contentType;
  if (contentType) headers.set("content-type", contentType);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", CACHE_CONTROL);

  const res = new Response(object.body, { headers });
  /* 응답을 먼저 돌려주고 캐시 쓰기는 뒤에 흘린다. OpenNext 의 waitUntil 래핑은 ISR 전용이라
     여기선 Cloudflare ctx 를 직접 부른다. clone 하는 이유: put 이 본문을 소비한다. */
  if (cache) ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}
