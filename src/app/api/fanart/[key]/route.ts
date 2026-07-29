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

/* **`immutable` 도 1년도 쓰지 않는다.** 키가 유일해 같은 주소의 *내용*은 안 바뀌므로 얼핏
   immutable 이 맞아 보이는데, 그건 이 자원이 **삭제된다**는 사실을 빠뜨린 판단이다(적대적
   리뷰 지적): 관리자가 잘못 올렸거나 내려 달라는 요청을 받아 팬아트를 지워도, 한 번이라도
   열린 URL 은 엣지·브라우저 캐시에서 1년간 그대로 서빙된다 — 내렸는데 안 내려간다.

   Cache API 의 `delete` 로 지우는 길도 온전하지 않다: 그건 그 요청을 받은 콜로케이션의 캐시만
   비우고 다른 지역에 퍼진 사본은 남는다. "지웠다"고 믿게 만드는 부분 해결이 더 위험하다.

   그래서 수명을 짧게 둔다. 1시간이면 그 주를 여는 트래픽 피크는 캐시가 받고(팬아트는 주 단위로
   집중해서 열린다), 삭제는 최악 1시간 뒤 실제로 반영된다. `immutable` 을 빼서 만료 뒤에는
   ETag 재검증(304)이 돌아, 안 바뀐 그림은 바이트를 다시 안 보낸다.

   그리고 **헤더만으로는 Worker 응답이 엣지 캐시에 안 앉는다**(AGENTS 지뢰): Worker 가 zone
   캐시보다 먼저 요청을 받으므로, 직접 `caches.default` 에 넣지 않으면 이 헤더는 브라우저
   캐시에만 통한다. 아래 waitUntil 이 그 자리를 채운다. */
const CACHE_CONTROL = "public, max-age=3600";

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

  /* **조건부 요청을 실제로 처리한다.** 위 CACHE_CONTROL 주석이 "만료 뒤엔 ETag 재검증(304)에
     맡긴다"고 약속했는데, `If-None-Match` 를 안 보면 그 약속이 코드에 없는 것이다 — 만료된
     캐시가 되물을 때마다 전체 바이트가 다시 나간다(코드 리뷰 지적). 여기서 끊으면 그 왕복이
     헤더만으로 끝난다.

     `body` 를 안 만지므로 R2 스트림은 소비되지 않는다 — get 호출 자체는 이미 했지만 바이트는
     안 흐른다. `onlyIf` 로 R2 에 조건을 맡기지 않는 이유: 그건 `Headers` 나 etag 문자열의
     따옴표 규약에 기대는데, 이 경계는 dev 에서 Miniflare 프록시 직렬화에 한 번 물린 자리라
     (위 writeHttpMetadata 주석) 우리가 이미 들고 있는 값을 직접 비교하는 쪽이 확실하다. */
  if (req.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  const res = new Response(object.body, { headers });
  /* 응답을 먼저 돌려주고 캐시 쓰기는 뒤에 흘린다. OpenNext 의 waitUntil 래핑은 ISR 전용이라
     여기선 Cloudflare ctx 를 직접 부른다. clone 하는 이유: put 이 본문을 소비한다. */
  if (cache) ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}
