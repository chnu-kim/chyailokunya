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

/* 예외는 **문장 단위**다. 한때 `app/landing/page.tsx` 를 파일째 건너뛰었는데, 그러면 그 페이지에
   새 문구가 들어와도 영영 안 걸린다 — 규칙을 세워 놓고 뒷문을 같이 낸 셈이다(적대적 리뷰가 잡았다).

   여기 있는 다섯은 구 정적 사이트에서 이식된 **소개 산문**이다(Phase 2). landing 은 페이지
   전체가 하나의 소개 글이라("어디서 만날까냥" 같은 제목까지 그 문체다) 그 안에서 "이건 UI,
   저건 산문"을 가르는 건 자의적이고, 어투를 규칙으로 눌러 고치면 글맛이 죽는다. 대신 **목록에
   적힌 문장만** 통과시켜 새 문구는 반드시 걸리게 한다.

   새 문장을 여기 더할 땐 그게 정말 사용자가 쓴 글인지 먼저 묻는다 — 안내문·오류·버튼이면
   합쇼체로 고칠 자리이지 여기 넣을 자리가 아니다. */
const KEPT_COPY = new Set([
  "오늘도 방송에서 쿠냥이들을 기다려요.",
  "천천히 놀다 가요",
  "오늘도 방송에서 만나요",
  "온도차가 쿠냐예요.",
  "치지직에서 방송하고, 유튜브에 클립 올리고, X로 소식 전해요.",
]);

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
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(HAEYO)) {
        const text = m[0].trim();
        if (KEPT_COPY.has(text)) continue;
        offenders.push(`${rel}:${i + 1}  ${text}`);
      }
    });
  }
  /* 빈 배열과 대조한다 — 개수를 세면 "몇 개까지는 괜찮다"로 읽히고, 실패 메시지에 어느 줄인지가
     안 남아 고치는 사람이 다시 찾아야 한다. */
  expect(
    offenders,
    "합쇼체로 고친다(AGENTS.md 톤 규칙). 이식된 소개 산문이면 KEPT_COPY 에 그 문장을 적는다",
  ).toEqual([]);
});
