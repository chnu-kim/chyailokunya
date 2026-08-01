#!/usr/bin/env node
/* PR 전후 스크린샷을 픽셀 단위로 비교해 before/after/diff PNG 와 요약(summary.json)을 만든다.
   정답 대조가 아니라 참고용이다 — 실제 시각 회귀 판정(baseline 비교)은 로컬 npm run e2e:visual
   이 맡는다(AGENTS.md, OS 별 베이스라인이라 CI 게이트엔 없다).

   e2e:visual 프로젝트가 만드는 <이름>-visual-<platform>.png 파일명은 before·after 두 잡이
   같은 OS(ubuntu-latest)에서 돌아 항상 일치한다 — 로컬 macOS 베이스라인(-darwin)과는 무관하고
   이 스크립트도 그 파일을 건드리지 않는다.

   사용: node scripts/visual-diff.mjs <beforeDir> <afterDir> <outDir> */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const [, , beforeDir, afterDir, outDir] = process.argv;
if (!beforeDir || !afterDir || !outDir) {
  console.error("사용: node scripts/visual-diff.mjs <beforeDir> <afterDir> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function listPngs(dir) {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((f) => f.endsWith(".png")));
}

// 캡처 잡이 워크플로에서 남긴 outcome 표식. steps.capture.outcome 은 continue-on-error 적용
// *전* 의 진짜 성패라, 일부 시나리오가 타임아웃·assert 실패로 안 찍혀도 여기서 "failure" 로
// 잡힌다(캡처 스텝 자체는 continue-on-error 로 초록이라 워크플로만 보면 안 드러난다).
function readCaptureStatus(dir) {
  const path = join(dir, "_capture-status.json");
  if (!existsSync(path)) return "unknown";
  try {
    return JSON.parse(readFileSync(path, "utf8")).outcome ?? "unknown";
  } catch {
    return "unknown";
  }
}

// 두 캡처가 폭·높이를 다르게 찍었을 수 있다(레이아웃이 바뀌어 fullPage 높이가 늘어나는 등).
// pixelmatch 는 같은 치수만 받으므로 큰 쪽 캔버스에 투명 배경으로 맞춘 뒤 비교한다 — 그러면
// 늘어난/줄어든 영역도 "다르다"로 정확히 잡힌다.
function padTo(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const padded = new PNG({ width, height });
  PNG.bitblt(png, padded, 0, 0, png.width, png.height, 0, 0);
  return padded;
}

const beforeFiles = listPngs(beforeDir);
const afterFiles = listPngs(afterDir);
const allNames = [...new Set([...beforeFiles, ...afterFiles])].sort();

const captureStatus = { before: readCaptureStatus(beforeDir), after: readCaptureStatus(afterDir) };
// "success" 만 완전하다고 믿는다 — "failure"·"unknown"(상태 파일 자체가 없음) 둘 다 그 쪽의
// 캡처를 못 믿는다는 뜻이다.
const captureComplete = captureStatus.before === "success" && captureStatus.after === "success";

const result = {
  captureStatus,
  changed: [],
  unchanged: [],
  added: [],
  removed: [],
  incomplete: [],
};

for (const name of allNames) {
  const base = name.replace(/\.png$/, "");
  const inBefore = beforeFiles.has(name);
  const inAfter = afterFiles.has(name);

  if (inBefore !== inAfter) {
    // 한쪽에만 있는 파일은 "그 시나리오가 진짜 추가/삭제됐다"와 "캡처가 그 시나리오에서
    // 실패해 안 찍혔다"를 파일 목록만으로 구분할 수 없다. 캡처가 완전할 때만 추가/삭제로
    // 단정한다 — 안 그러면 실패를 "삭제됨"으로 잘못 보고하게 된다.
    if (captureComplete) {
      if (inBefore) {
        result.removed.push(name);
        writeFileSync(join(outDir, `${base}-before.png`), readFileSync(join(beforeDir, name)));
      } else {
        result.added.push(name);
        writeFileSync(join(outDir, `${base}-after.png`), readFileSync(join(afterDir, name)));
      }
    } else {
      result.incomplete.push(name);
    }
    continue;
  }

  // 업로드·다운로드 중 잘리거나 손상된 PNG 하나 때문에 스크립트 전체가 죽으면 안 된다 — 나머지
  // 12개 시나리오까지 통째로 유실되고, summary.json 자체가 안 만들어져 diff-and-comment 의
  // 나머지 스텝이 전부 스킵된다(그러면 PR 코멘트가 낡은 실행 결과에 그대로 고정된다). 못 읽은
  // 파일은 "판정 보류"로 넘기고 계속 진행한다.
  let beforePng, afterPng;
  try {
    beforePng = PNG.sync.read(readFileSync(join(beforeDir, name)));
    afterPng = PNG.sync.read(readFileSync(join(afterDir, name)));
  } catch (e) {
    console.error(`${name} — PNG 디코드 실패, 판정 보류: ${e.message}`);
    result.incomplete.push(name);
    continue;
  }
  const sizeChanged = beforePng.width !== afterPng.width || beforePng.height !== afterPng.height;

  const width = Math.max(beforePng.width, afterPng.width);
  const height = Math.max(beforePng.height, afterPng.height);
  const beforePadded = padTo(beforePng, width, height);
  const afterPadded = padTo(afterPng, width, height);

  const diff = new PNG({ width, height });
  // 이 저장소의 실제 시각 회귀 게이트(npm run e2e:visual)는 Playwright 기본 threshold(0.2,
  // YIQ)를 쓴다 — 여기도 같은 값을 써야 "이 도구가 changed 라는데 저장소 게이트는 통과한다"는
  // 혼선이 안 생긴다(threshold 0.1 은 대략 4배 더 민감해 안티앨리어싱 수준의 차이도 잡는다,
  // 실측 확인).
  const diffPixels = pixelmatch(beforePadded.data, afterPadded.data, diff.data, width, height, {
    threshold: 0.2,
  });

  if (diffPixels === 0 && !sizeChanged) {
    result.unchanged.push(name);
    continue;
  }

  writeFileSync(join(outDir, `${base}-before.png`), readFileSync(join(beforeDir, name)));
  writeFileSync(join(outDir, `${base}-after.png`), readFileSync(join(afterDir, name)));
  writeFileSync(join(outDir, `${base}-diff.png`), PNG.sync.write(diff));

  result.changed.push({
    name,
    diffPixels,
    diffRatio: diffPixels / (width * height),
    sizeChanged,
    beforeSize: `${beforePng.width}×${beforePng.height}`,
    afterSize: `${afterPng.width}×${afterPng.height}`,
  });
}

writeFileSync(join(outDir, "summary.json"), JSON.stringify(result, null, 2));

console.log(
  `변경 ${result.changed.length} · 추가 ${result.added.length} · 삭제 ${result.removed.length} · ` +
    `동일 ${result.unchanged.length} · 판정불가 ${result.incomplete.length} ` +
    `(캡처: before=${captureStatus.before} after=${captureStatus.after})`,
);
