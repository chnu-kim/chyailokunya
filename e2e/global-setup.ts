import { execFileSync } from "node:child_process";

/* e2e 는 결정적 픽스처로 돈다(스모크·시각 공통). 실제 chzzk 시드가 아니라 로컬 D1 에 고정
   게임을 심어 네트워크·데이터 변화에 안 흔들리게 한다. 매 실행 전에:
     1) 로컬 D1 에 마이그레이션 적용(스키마가 없으면 games 페이지가 500 난다),
     2) games 를 픽스처로 리셋(dev 시드는 덮인다 — 실제 보드는 npm run db:seed -- --local 로 되살림).
   전부 --local 이라 CF 인증이 필요 없어 리눅스 CI 에서도 그대로 돈다. reuseExistingServer 로
   dev 서버를 재사용해도 globalSetup 은 항상 돌아 데이터가 결정적이다(dev 는 요청마다 D1 을
   읽으므로 이 준비가 첫 테스트 전에 끝나면 된다). */
function wrangler(args: string[]) {
  execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
}

export default function globalSetup() {
  wrangler(["d1", "migrations", "apply", "chyailokunya", "--local"]);
  wrangler([
    "d1",
    "execute",
    "chyailokunya",
    "--local",
    "--file",
    "e2e/fixtures/games.sql",
    "--yes",
  ]);
}
