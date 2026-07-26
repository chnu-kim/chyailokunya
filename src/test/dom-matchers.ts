import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/* 이 저장소는 test.globals 를 안 켠다(다른 설정과 같은 명시성 원칙) — 그래서
   @testing-library/react 의 자동 언마운트가 안 걸린다("globals 가 있어야 자동 cleanup 이
   된다"는 걸 Vitest 문서가 명시한다). 안 걸면 한 파일의 여러 it() 가 서로의 DOM 을 이어받아
   두 번째 렌더부터 같은 텍스트가 둘로 잡힌다(실측). */
afterEach(() => {
  cleanup();
});
