# CLAUDE.md

이 파일은 Claude Code(claude.ai/code)가 이 저장소에서 작업할 때의 지침이다.

프로젝트 지침의 정본은 [`AGENTS.md`](./AGENTS.md) 다. 아래 import 로 전체를 읽어온다 —
**규칙을 고칠 땐 이 파일이 아니라 `AGENTS.md` 를 고친다.**

@AGENTS.md

## 빠른 요약

챠이로 쿠냐 팬사이트를 정적 → Next.js 풀스택(Cloudflare Workers)으로 옮긴 저장소.
빌드·타입·테스트·경계가 **CI 게이트**로 검증을 강제한다(정적 사이트 시절과 다르다).
결정의 "왜"는 [`docs/adr/`](./docs/adr/), 규칙·불변식·지뢰 목록은 `AGENTS.md`.

- 검증은 로컬에서 `npm run build && npm test && npm run typecheck && npm run lint &&
npm run boundaries` 로 그대로 돌린다. 배포는 main 푸시 시 Cloudflare Workers Builds.
- PR 을 만들면(`gh pr create`) 직후 `/codex-pr-review --base <base>` 를 실행한다(전역 지침).
- remote 가 SSH 면 푸시가 키 주인 명의로 나갈 수 있다 — HTTPS + `gh auth git-credential`
  로 해당 푸시에만 자격증명을 적용한다(자세히는 AGENTS.md "지뢰").
