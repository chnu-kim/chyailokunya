#!/usr/bin/env node
/* visual-diff.mjs 가 만든 summary.json 을 PR 코멘트 마크다운으로 만든다. 이미지는 워크플로가
   같은 실행에서 커밋한 visual-diffs/pr-<번호> 브랜치의 <headSha> 하위 디렉터리를
   raw.githubusercontent.com 으로 직접 가리킨다 — 별도 호스팅 없이 PR 코멘트에 인라인으로
   뜬다(공개 저장소라 인증 없이 열린다). 경로에 headSha 를 섞는 이유는 브랜치명이 안 바뀐 채
   같은 파일명을 매번 force-push 로 덮어쓰면, 그 URL 을 캐싱하는 프록시(PR 코멘트 이미지의
   camo)가 이전 푸시의 스크린샷을 계속 보여줄 수 있어서다 — 커밋마다 경로 자체가 달라지면
   그 위험이 구조적으로 없어진다.

   맨 앞의 마커 주석(<!-- visual-diff-bot -->)은 워크플로가 기존 코멘트를 찾아 덮어쓸 때 쓴다 —
   없으면 실행마다 새 코멘트가 쌓인다.

   사용: node scripts/build-visual-diff-comment.mjs <summary.json> <owner/repo> <branch> <headSha> */

import { readFileSync } from "node:fs";

const [, , summaryPath, repo, branch, headSha] = process.argv;
if (!summaryPath || !repo || !branch || !headSha) {
  console.error(
    "사용: node scripts/build-visual-diff-comment.mjs <summary.json> <owner/repo> <branch> <headSha>",
  );
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const raw = (file) =>
  `https://raw.githubusercontent.com/${repo}/${branch}/${headSha}/${encodeURIComponent(file)}`;

const lines = [];
lines.push("<!-- visual-diff-bot -->");
lines.push("## 시각 회귀 비교 (before/after)");
lines.push("");
lines.push(
  "이 PR의 UI 변경을 베이스 브랜치와 대조한 스크린샷입니다. **참고용**입니다 — 실제 시각 " +
    "회귀 판정(베이스라인 대조)은 로컬 `npm run e2e:visual` 이 맡습니다(OS 별 베이스라인이라 " +
    "이 워크플로와 기준이 다를 수 있습니다).",
);
// 이 코멘트가 최신 푸시 결과인지 알 방법이 없으면(예: 다음 실행이 크래시로 갱신에 실패) 낡은
// 결과가 최신인 척 남는다 — 어느 커밋 기준인지 명시해 최소한의 신선도 신호를 남긴다.
lines.push(`_기준 커밋: \`${headSha.slice(0, 7)}\`_`);
lines.push("");

// 캡처가 한쪽이라도 완전하지 않으면(타임아웃·assert 실패 등) "추가/삭제"는 이미 판정을 보류한
// 상태다(visual-diff.mjs) — 그 사실을 코멘트 맨 위에서 먼저 밝혀야, 아래 표가 조용히 일부만
// 보여주는 걸 "전부 봤다"로 오해하지 않는다.
const captureOk = (s) => s === "success";
const captureComplete =
  summary.captureStatus &&
  captureOk(summary.captureStatus.before) &&
  captureOk(summary.captureStatus.after);
if (summary.captureStatus && !captureComplete) {
  lines.push(
    `> ⚠️ **캡처가 완전하지 않습니다** (before: \`${summary.captureStatus.before}\`, ` +
      `after: \`${summary.captureStatus.after}\`). 일부 시나리오가 타임아웃·오류로 안 찍혔을 ` +
      "수 있어, 이번 실행에선 **추가/삭제 판정을 보류**했습니다(아래 '판정 보류' 목록). " +
      "실패 원인은 Actions 로그에서 확인하십시오.",
  );
  lines.push("");
}

const incompleteCount = summary.incomplete ? summary.incomplete.length : 0;
// changed/added/removed/unchanged/incomplete 전부 0이면 "비교 결과 0건"이 아니라 "비교
// 자체를 못 했다" — before·after 양쪽 다 PNG 를 한 장도 못 찍은 경우가 정확히 이 모양이다.
// 이걸 걸러내지 않으면 바로 위 "캡처가 완전하지 않습니다" 경고 다음 줄에 "변경된 화면이
// 없습니다"라는 **모순되는 안심 문구**가 붙는다 — 실제로 재현되는 결함이라 반드시 가른다.
const totalScenarios =
  summary.changed.length +
  summary.added.length +
  summary.removed.length +
  summary.unchanged.length +
  incompleteCount;
const nothingChanged =
  summary.changed.length === 0 && summary.added.length === 0 && summary.removed.length === 0;

if (totalScenarios === 0) {
  lines.push(
    "**비교할 스크린샷이 하나도 없습니다.** before·after 양쪽 다 캡처된 화면이 없어 " +
      '"변경 없음"조차 판정할 수 없습니다 — 캡처 자체가 실패했을 가능성이 큽니다. ' +
      "Actions 로그를 확인하십시오.",
  );
} else if (nothingChanged && incompleteCount === 0) {
  lines.push(`변경된 화면이 없습니다 (${summary.unchanged.length}개 시나리오 동일).`);
} else {
  if (summary.changed.length > 0) {
    lines.push(`### 변경됨 (${summary.changed.length})`);
    lines.push("");
    lines.push("| 시나리오 | Before | After | Diff |");
    lines.push("| --- | --- | --- | --- |");
    for (const c of summary.changed) {
      const base = c.name.replace(/\.png$/, "");
      const note = c.sizeChanged ? ` (크기 변경: ${c.beforeSize} → ${c.afterSize})` : "";
      lines.push(
        `| ${base}${note} | <img src="${raw(`${base}-before.png`)}" width="280"> | ` +
          `<img src="${raw(`${base}-after.png`)}" width="280"> | ` +
          `<img src="${raw(`${base}-diff.png`)}" width="280"> |`,
      );
    }
    lines.push("");
  }

  if (summary.added.length > 0) {
    lines.push(`### 새로 추가된 시나리오 (${summary.added.length})`);
    lines.push("");
    for (const name of summary.added) {
      const base = name.replace(/\.png$/, "");
      lines.push(
        `<details><summary>${base}</summary>\n\n<img src="${raw(`${base}-after.png`)}" width="600">\n\n</details>`,
      );
    }
    lines.push("");
  }

  if (summary.removed.length > 0) {
    lines.push(`### 삭제된 시나리오 (${summary.removed.length})`);
    lines.push("");
    for (const name of summary.removed) {
      const base = name.replace(/\.png$/, "");
      lines.push(
        `<details><summary>${base}</summary>\n\n<img src="${raw(`${base}-before.png`)}" width="600">\n\n</details>`,
      );
    }
    lines.push("");
  }

  if (incompleteCount > 0) {
    lines.push(`### 판정 보류 (${incompleteCount})`);
    lines.push("");
    lines.push(
      "캡처가 불완전하거나 이미지가 손상돼 추가·삭제·변경 여부를 못 정한 시나리오입니다 — " +
        "실제로 화면이 바뀐 게 아니라 캡처·전송 실패일 수 있습니다.",
    );
    lines.push("");
    lines.push(summary.incomplete.map((n) => `- ${n}`).join("\n"));
    lines.push("");
  }

  if (summary.unchanged.length > 0) {
    lines.push(
      `<details><summary>변경 없음 (${summary.unchanged.length})</summary>\n\n` +
        `${summary.unchanged.map((n) => `- ${n}`).join("\n")}\n\n</details>`,
    );
  }
}

console.log(lines.join("\n"));
