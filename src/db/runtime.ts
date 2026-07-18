/* 요청 런타임에서 D1 바인딩을 꺼내 Drizzle 클라이언트를 만든다. getCloudflareContext 는
   OpenNext 런타임(과 initOpenNextCloudflareForDev 로 dev)에서만 유효하므로 이 모듈은
   app(route·server component)만 쓴다 — 워커 풀 단위테스트는 makeDb(env.DB)로 직접 주입해
   이 경로를 타지 않는다(그래서 테스트가 OpenNext 를 import 하지 않는다). */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { makeDb, type Db } from "./index";

export function getDb(): Db {
  return makeDb(getCloudflareContext().env.DB);
}
