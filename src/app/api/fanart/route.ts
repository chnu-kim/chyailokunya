/* 팬아트 업로드(ADR-0028). 파일 바이트를 실어 나르므로 tRPC 가 아니라 Route Handler 다 —
   tRPC 는 JSON 경계라 이미지를 base64 로 부풀려 통과시켜야 하고, 그 인코딩 비용이 Worker 의
   요청당 CPU 예산에 그대로 얹힌다.

   본문은 **raw 바이트**다(multipart 가 아니라). 파일 하나만 받는 자리라 폼 파싱이 표현할 게
   없고, `request.formData()` 는 경계 문자열을 훑는 만큼 CPU 를 더 쓴다. 클라이언트는
   `fetch(…, { method: "POST", body: file })` 한 줄이면 된다.

   성공하면 `{ key }` 만 돌려준다 — 이 라우트는 **바이트만 맡는다.** 그 키가 어느 주에 걸리는지는
   저장 뮤테이션(saveWeek)의 일이다. 그래서 업로드했지만 저장 안 한 객체가 남을 수 있다(고아) —
   ADR-0028 이 고른 실패 방향이다. 반대(행이 가리키는 키가 없는 상태)는 그림이 깨진다. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  FANART_MAX_BYTES,
  fanartContentType,
  fanartKey,
  fanartObjectKey,
  isOverFanartLimit,
  sniffImageType,
} from "@/core/fanart";
import { makeDb } from "@/db";
import { rejectCrossSiteFetch, rejectForeignOrigin } from "@/features/auth/request-guard";
import { authoritiesForActor, getServerActor } from "../../server-session";

// 본문 크기는 두 번 본다 — 헤더로 한 번(바이트를 안 읽고 즉시 거절), 실제 길이로 한 번.
// Content-Length 는 클라이언트의 주장이라 그것만 믿으면 상한이 통째로 뚫린다.
function tooLarge(): Response {
  return Response.json(
    { error: `파일이 너무 큽니다. ${FANART_MAX_BYTES / 1024 / 1024}MB 이하만 올릴 수 있습니다.` },
    { status: 413 },
  );
}

/* 본문을 **읽으면서** 상한을 건다 — `arrayBuffer()` 로 통째로 받으면 안 되는 이유가 있다:
   Content-Length 가 없는 요청(청크 전송)은 위 헤더 검사를 그냥 지나치므로, 그때는 상한이
   "R2 에 안 넣는다"만 보장하고 **메모리 보호로는 무의미해진다**(코드 리뷰 지적). 상한을 넘는
   순간 읽기를 끊어 그 뒤 바이트를 아예 안 받는다.

   넘으면 null 을 돌려준다(호출자가 413). 본문이 없으면 빈 배열이다 — "비어 있다"의 판정은
   호출자가 한다(형식 판정과 같은 자리에서 갈려야 문구가 안 갈린다). */
async function readCapped(req: Request): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (isOverFanartLimit(total)) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export async function POST(req: Request) {
  /* 크로스사이트 차단 → Origin 검증. tRPC 라우트와 같은 순서·같은 함수를 쓴다(request-guard 가
     정본) — 여기만 규칙이 다르면 "쓰기 경로 하나가 CSRF 방어에서 빠진" 상태가 된다. */
  const crossSite = rejectCrossSiteFetch(req);
  if (crossSite) return crossSite;

  const { env } = getCloudflareContext();
  const denied = rejectForeignOrigin(req, env.AUTH_URL);
  if (denied) return denied;

  /* 인가는 서버가 정본이다(불변식 3). tRPC 의 authorizedProcedure 와 같은 판정을 같은 소스에서
     파생한다 — UI 가 버튼을 감추는 것과 무관하게 여기서 막힌다. */
  const claims = await getServerActor();
  const actor = claims ? { userId: claims.userId, channelId: claims.channelId } : null;
  if (!actor) return Response.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const authorities = await authoritiesForActor(makeDb(env.DB), actor);
  if (!authorities.has("schedule:write")) {
    return Response.json({ error: "권한이 필요합니다" }, { status: 403 });
  }

  // 헤더로 먼저 거른다 — 상한을 넘는 요청의 바이트를 메모리에 올리지 않는다.
  if (isOverFanartLimit(Number(req.headers.get("content-length")))) return tooLarge();

  // 헤더는 클라이언트의 주장이다 — 실제로 읽으면서 다시 본다(그것만 믿으면 상한이 통째로 뚫린다).
  const bytes = await readCapped(req);
  if (bytes === null) return tooLarge();
  if (bytes.byteLength === 0) {
    return Response.json({ error: "파일이 비어 있습니다" }, { status: 400 });
  }

  /* **확장자도 Content-Type 도 안 믿는다** — 실제 바이트 앞머리로 판정한다(core/fanart.ts).
     그래서 우리 origin 에서 서빙되는 Content-Type 은 클라이언트가 보낸 값이 아니라 이 판정의
     결과다. svg 처럼 마크업인 형식은 애초에 통과하지 않는다. */
  const type = sniffImageType(bytes);
  if (!type) {
    return Response.json(
      { error: "PNG · JPEG · WebP 이미지만 올릴 수 있습니다." },
      { status: 415 },
    );
  }

  const key = fanartKey(type, crypto.randomUUID());
  await env.FANART.put(fanartObjectKey(key), bytes, {
    httpMetadata: { contentType: fanartContentType(type) },
  });

  return Response.json({ key }, { status: 201 });
}
