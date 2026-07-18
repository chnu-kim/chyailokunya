// Auth.js 라우트 핸들러(ADR-0017). /api/auth/* 의 로그인·콜백·로그아웃·세션을 처리한다.
// 실제 설정·콜백은 src/auth.ts 가 정본 — 여기선 handlers 만 노출한다.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
