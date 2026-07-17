// DB 레이어의 자리표시자. Phase 3 에서 Drizzle 클라이언트(D1 바인딩)와 스키마가 여기 붙는다.
// 경계: db 는 core 만 import 한다 — features·components·app 로 올라가지 않는다(.dependency-cruiser.cjs).
export const DB_LAYER = "chyailokunya/db" as const;
