import { defineConfig } from "drizzle-kit";

// D1 은 SQLite 다 — dialect 는 'sqlite'. generate 만 여기서 하고(스키마 → SQL),
// 적용은 wrangler d1 migrations apply(=wrangler.jsonc 의 migrations_dir) 와
// 단위테스트의 applyD1Migrations 가 맡는다. 그래서 out 을 wrangler migrations_dir 과
// 같은 './drizzle' 로 둔다 — wrangler 는 meta/_journal.json 을 무시하고 NNNN_*.sql 만 읽는다.
// 원격 push/pull(d1-http) 은 쓰지 않는다: 마이그레이션은 파일이 정본이고 CI·테스트에서
// 재현돼야 하므로, 원격 상태를 직접 밀어넣는 경로를 두지 않는다(YAGNI).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
