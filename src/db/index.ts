/* D1 바인딩 위의 Drizzle 클라이언트 팩토리. 경계: db 는 core 만 import 한다 —
   features·components·app 로 올라가지 않는다(.dependency-cruiser.cjs).

   makeDb 는 D1 을 명시적으로 받는다 — 단위테스트는 cloudflare:test 의 env.DB 를 주입하고,
   요청 런타임(app·middleware)은 getCloudflareContext().env.DB 를 꺼내 넘긴다. 이 파일이
   OpenNext(getCloudflareContext)를 import 하지 않아, 워커 풀 단위테스트가 db 를 가볍게
   import 한다. */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * from "./schema";

export type Db = ReturnType<typeof makeDb>;

export function makeDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
