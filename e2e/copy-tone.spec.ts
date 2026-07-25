/* 사용자 노출 문구가 합쇼체인지 기계가 본다(AGENTS.md 톤 규칙).

   이 검사가 없으면 규칙이 사람의 기억에 걸린다 — 실제로 그렇게 샜다: 2026-07-26 에 앱 전체를
   합쇼체로 옮기면서 큰따옴표만 훑는 grep 을 썼고, **템플릿 리터럴과 여러 줄 JSX 텍스트를
   통째로 놓쳤다.** 제안 상한 오류(`개예요`)는 로그인 사용자가 실제로 닿는 경로였는데도 남았고,
   그걸 리뷰 둘이 각각 잡았다. 규칙을 새로 세우는 변경에는 그 규칙을 지키는 기계가 같이 와야 한다.

   **왜 unit 이 아니라 e2e 인가.** 단위 테스트는 workerd 안에서 돌아 `fs` 가 없어 소스를 훑을
   수가 없다(routes.spec.ts 가 같은 이유로 여기 산다). 브라우저를 안 쓴다. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/* 해요체 어미. 화면에 나가는 문장이 이걸로 끝나면 규칙 위반이다 — "~합니다·~입니다·~주십시오"
   여야 한다. 어간이 아니라 **종결형**만 본다(예: '가요'는 걸리지만 '가요제'는 안 걸린다). */
const HAEYO =
  /[가-힣][가-힣\s,·—…'"()%0-9A-Za-z]*(어요|에요|예요|해요|아요|여요|네요|군요|세요|돼요|봐요|와요|가요|나요|워요|려요|게요)[.!?…]?/g;

/* **주석은 대상이 아니다.** 문구를 인용해 근거를 적는 주석이 이 저장소엔 많고(왜 그 문구를
   버렸는지 적은 자리들), 그것까지 막으면 역사를 못 적는다. 화면에 나가는 건 코드뿐이다. */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    "\n".repeat((m.match(/\n/g) ?? []).length),
  );
  return noBlock.replace(/\/\/[^\n]*/g, "");
}

/* 소개 카피는 예외다 — UI 문구가 아니라 **사용자가 쓴 글**이고, 구 정적 사이트에서 그대로
   이식됐다(Phase 2). 캐릭터 소개·인사말의 어투를 규칙으로 눌러 고치면 글맛이 죽는다.
   파일 단위로 열어 두되 그 밖의 어디서도 예외를 허용하지 않는다 — 예외가 늘면 규칙이 흐려진다. */
const COPY_FILES = new Set(["app/landing/page.tsx"]);

function sourceFiles(dir: string = SRC_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    // 테스트는 옛 문구를 단언할 수 있다(회귀를 못박는 자리라 그 문자열이 그대로 필요하다).
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) found.push(full);
  }
  return found;
}

test("사용자 노출 문구에 해요체가 남아 있지 않다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const rel = file.slice(SRC_DIR.length + 1).replaceAll("\\", "/");
    if (COPY_FILES.has(rel)) continue;
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(HAEYO)) offenders.push(`${rel}:${i + 1}  ${m[0].trim()}`);
    });
  }
  /* 빈 배열과 대조한다 — 개수를 세면 "몇 개까지는 괜찮다"로 읽히고, 실패 메시지에 어느 줄인지가
     안 남아 고치는 사람이 다시 찾아야 한다. */
  expect(offenders, "합쇼체로 고친다(AGENTS.md 톤 규칙). 소개 카피면 COPY_FILES 에 넣는다").toEqual(
    [],
  );
});
