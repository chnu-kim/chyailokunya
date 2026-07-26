# ADR-0026: 클라이언트 상태 = XState 단일 표현 (Zustand·Jotai·TanStack Query 기각)

- 상태: Accepted
- 날짜: 2026-07-26

## 맥락

에픽 #77 이 실측한 결함 넷이 발단이다 — `GameBoard`(1051줄) 하나가 `useState` 12개 + `useRef`
3개로 보드·상세·편집·삭제·제안·제안함 6개 흐름을 조립하고, 그 결과:

1. **모달 스택이 암묵적이다.** 열림 상태가 독립 변수 6개(`composing`·`detail`·`suggesting`·
   `inboxOpen`·`editing`·`deleting`)라 `composing && editing` 같은 불가능 조합이 타입으로
   표현 가능하다. 지금 이를 막는 건 "그런 setter 를 안 부른다"는 관례뿐이다.
2. **한 사건이 setState 여러 번이다.** 원자성이 코드에 안 적혀 있다(`onRemoved` 가 5개 상태를
   동시에 바꾼다).
3. **같은 상태 기계가 6곳에 복붙돼 있다** — `error`+`closing`+`done`+`useTransition`+
   `AbortSignal.timeout` 세트가 composer · suggest-dialog · suggestion-inbox · GameEditor ·
   GameDeleteConfirm · schedule-editor 에 그대로 있다.
4. **배치 오류** — `error-message.ts` 는 import 가 하나도 없는 순수 모듈인데 `games/` 에
   살고, `claimWeek` 은 `schedule_weeks` 에 쓰는데 `features/games/service.ts` 에 있다(별도
   PR, #79 가 다룬다 — 이 ADR 의 범위는 상태 표현이다).

판정 기준은 **변경 지점 예측 가능성**이다 — "이 기능을 고치려면 어느 파일을 여는가"가
이름만 보고 나오는 상태. 파일당 줄 수 상한이 아니다.

## 결정

**클라이언트 상태의 단일 표현으로 XState 를 쓴다.** 오버레이 스택·모달 제출·히스토리는
진짜 상태차트다 — 계층·가드·invoke 가 1급이라 지금 주석으로 지키는 규칙을 기계가 강제한다.

머신 8종:

| 머신              | 수명                            | 대체하는 것                                                 |
| ----------------- | ------------------------------- | ----------------------------------------------------------- |
| `board-overlay`   | 화면 공유(`createActorContext`) | `useState` 6 + `ref` 1 · 복붙된 파생값                      |
| `submit`          | 폼 지역(`useMachine`) × 6       | `error`+`closing`+`done`+`useTransition`+타임아웃 복붙      |
| `dialog-shell`    | 폼 지역                         | `confirmingDiscard` + `latest` ref + `useLayoutEffect` 가드 |
| `dialog-history`  | **앱 전역 액터**                | 모듈 싱글턴 `none`/`live`/`popping`(`game-dialog.tsx`)      |
| `composer`        | 폼 지역                         | `core/games-composer.ts` 순수 리듀서(액션 9종) 이관         |
| `play-dates-load` | 폼 지역                         | `dates`/`loadedDate`/`loadFailed`                           |
| `inbox-load`      | 폼 지역                         | `items`(null=로딩) + `rejectingId`                          |
| `schedule-save`   | 화면 공유                       | `draft`/`baseline`/`revision`/`seqRef` CAS                  |

`dialog-history` 가 전역인 이유: 브라우저 히스토리 스택은 문서에 하나뿐이다. 모달 여럿이
그 하나를 공유하고, "엔트리가 있다"와 "지금 자리다"를 가르는 토큰 표식도 전역이어야
성립한다 — 컴포넌트 지역 머신으로 만들면 그 계약이 깨진다.

머신은 `src/core/*.machine.ts` 에 두고 `@xstate/react` 는 `src/app` 에서만 쓴다.
`core/calendar.ts` 가 `temporal-polyfill` 을 쓰는 선례가 있어 core 에 npm 의존 자체는 규칙
위반이 아니다 — 머신이 순수해야 workerd 단위 테스트가 그대로 산다. 부수효과(실제 DOM 호출
`history.pushState`/`popstate`)는 core 밖 `src/app/**/*.actor.ts` 가 맡는다.

**"core 는 순수 도메인 로직" 규칙과 충돌하지 않는다 — 새 예외가 아니라 기존 패턴의 연장이다.**
`core/games-composer.ts`(콤보박스 단계 전이·활성 인덱스)와 `core/schedule-editor.ts`(주간표
편집 상태)가 이미 지금 `src/app/games/game-composer.tsx`·`src/app/schedule/schedule-editor.tsx`
에 물려 라이브로 돈다 — 둘 다 "UI 상태"지만 core 에 사는 이유는 같다: **DOM/HTTP/React 를
안 끌어오는 순수 전이**이기만 하면 되고, 그 전이가 다루는 개념이 "도메인"인지 "UI 오케스트레이션"
인지는 경계 기준이 아니다. `board-overlay`·`dialog-history` 류 머신도 같은 조건(순수 전이,
부수효과는 `*.actor.ts`)을 만족하므로 이 선례를 그대로 잇는다.

**선 밖에 두는 것** — AGENTS.md 「코드 컨벤션」에 이미 규칙으로 실었다(이 PR 이 함께
넣는다 — ADR 은 근거, AGENTS.md 는 규칙이라는 ADR-0013 의 분리를 지킨다):

> 둘 이상이 함께 바뀌거나 / 불가능한 조합이 표현되거나 / 비동기가 끼면 →
> `core/*.machine.ts`. 그 밖은 `useState`·`useRef`·`useSyncExternalStore` 그대로다.

폼 값(`playedDate`·`title`·`WeekDraft`·`query`)은 혼자 바뀌고 불가능한 조합이 없어 대상이
아니다. DOM 핸들 `useRef` 는 직렬화·SSR 불가라 머신 context 에 못 넣는다 — 이건 무혼용이
불가능해 규칙으로 지킨다. `use-theme`(`useSyncExternalStore`)은 정본이 첫 페인트 전 인라인
스크립트가 심는 `data-theme` 속성이라 머신을 두면 정본이 둘이 된다(맞추려 effect 를 쓰면
`set-state-in-effect` 지뢰가 재발한다).

**규칙은 `xstate` 의존성과 DOM 테스트 프로젝트가 들어오는 #78 PR 2 머지 이후부터
적용된다** — 이 PR(ADR만)엔 그 둘이 없어 지금 당장 지키라고 하면 지킬 도구가 없다. 그
전까지 기존 코드는 이 규칙을 안 따른다. 머신 8종은 #79~#85 에 걸쳐 하나씩 배선된다.
에픽이 끝나면(PR 19) 실제로 짠 8종을 반영해 AGENTS.md 문단의 표현을 다듬는다(예: 지금은
없는 실제 파일 경로·예외 사례 추가).

## 검증 스파이크 — happy-dom 이 이 결정을 지탱하는가

XState 배선은 결국 컴포넌트 테스트로 잡아야 하는데, 이 저장소의 vitest 는 전부 workerd 풀
안에서 돈다(`vitest.config.ts` — DOM API 가 없다). 문서로 "DOM 프로젝트를 추가한다"고
적기 전에 실제로 돌려 확인했다(AGENTS.md Phase 4 지뢰와 같은 규율 — 런타임 계약은 실측
전엔 안 박는다).

**1단계 — raw happy-dom API.** `dialog.showModal()`→`close()` 뒤 `close` 이벤트, `document.
activeElement` 관측(모달 닫힘 후 트리거 포커스 복원 포함), `inert` 속성·IDL 프로퍼티 반영,
`history.pushState` 뒤 `popstate` 디스패치 — 넷 다 통과했다. 부수 발견: happy-dom 은 `inert`
하위 요소의 `focus()` 를 스펙대로 무시한다 — 포커스 복원을 native `close` 핸들러 안에서
**동기로** 하면 조상이 아직 inert 라 무시되고(실측), 실제 앱처럼 `useEffect`(리렌더 커밋
이후, inert 가 이미 풀린 시점)로 옮기면 통과한다. 이는 happy-dom 의 한계가 아니라 **정확도의
증거**다.

**2단계 — 실제 import 그래프.** raw API 가 되는 것과 이 저장소의 실제 컴포넌트가 마운트되는
건 다른 질문이다(`GameBoard` 는 tRPC·`next/link`·모듈 싱글턴 히스토리 컨트롤러·`core`/
`features` 를 전부 끌어온다). `vitest.config.ts` 에 `projects:[workerd, dom]`(`environment:
"happy-dom"`)을 실제로 구성하고 두 실제 컴포넌트를 마운트해 확인했다:

- **`SuggestionInbox`**(→`GameDialog`, 열림에 `trpc.suggestions.list.query` 호출) —
  `vi.mock("@/features/trpc/client", () => ({ trpc: { ... } }))` 로 모듈째 교체하면 그대로
  마운트되고 네이티브 `<dialog open>` 셸이 뜬다. **이 모양이 tRPC 를 쓰는 나머지 4개
  특성화 대상(#4~#8)이 공유할 목 형태다** — vanilla tRPC 클라이언트(`createTRPCClient`,
  ADR-0004)라 리액트 컨텍스트/프로바이더가 없고, 모듈 교체 하나로 끝난다.
- **`GameBoard`**(1051줄 전체) — 카드 렌더·클릭→상세 dialog 오픈까지 마운트된다. 특성화
  대상 1·2(`justAdded` 강조·삭제 후 포커스 이동)가 사는 파일이 실제로 dom 프로젝트에서
  돈다는 뜻이다.

부수 발견 하나 더: `@testing-library/react` 의 자동 언마운트는 **`test.globals: true` 가
있어야** 걸린다(Vitest 문서가 명시). 이 저장소는 다른 설정과 같은 이유로 globals 를 안
켜므로, setupFiles 에서 `afterEach(cleanup)` 을 **명시로** 등록해야 한다 — 안 하면 한 파일의
두 번째 `it()` 부터 이전 렌더가 DOM 에 남아 같은 텍스트가 둘로 잡힌다(실측).

**결론(스파이크 (a) — 그대로 진행):** jsdom 전환도, dialog·포커스·history 계열을 e2e 로
미루는 것도 불필요하다. 8종 특성화 전부 dom 프로젝트가 맡는다 — 경계는 ADR-0008 이 정본으로
적는다.

## 근거

- 매퍼 6종이 이미 `(e: unknown) => string` 로 시그니처가 같아 `submit` 머신에 문구까지
  주입하는 게 공짜다 — "failed 인데 보여줄 문구가 없다"가 타입으로 표현 불가능해진다.
- 머신 추가 PR 은 사용처가 0이라 위험이 0이고(#80~#85 의 PR 절단 전략), 배선 PR 하나만
  revert 하면 그 대상만 원상복구된다.
- ADR-0010(JIT)과 충돌하지 않는다 — 이번 결정은 **새 간접층을 더하는 게 아니라 같은 일을
  하는 표현 수단을 통일**하는 것이다(개정 이력 참고).

## 기각한 대안

- **Zustand·Jotai** — 스토어형은 "상태를 어디 두나"를 푼다. 이 앱엔 전역 공유 상태가
  0개다(전부 한 서브트리 안에서 산다). 풀 문제가 없고, `core` 는 React 무관이라 리듀서를
  스토어로 옮기면 순수 레이어가 오염된다.
- **TanStack Query** — `games` 목록의 정본은 서버 컴포넌트다. Query 를 넣으면 초기 props 와
  클라이언트 캐시가 이중 정본이 된다(`trpc/client.ts` 주석이 이미 기각한 자리).
- **순수 리듀서를 계속 손으로 복붙** — 지금 상태 그대로다. 6곳 복붙이 곧 결함 3이 지적하는
  그 자리다.
- **jsdom** — 스파이크 결과 happy-dom 이 이 저장소가 쓰는 네 가지 계약을 전부 스펙대로
  구현해 교체할 이유가 없었다.

## 결과

- (+) 오버레이 스택의 불가능 조합이 타입으로 안 만들어진다 — 상태차트가 가드로 강제한다.
- (+) `submit` 류 복붙 6곳이 머신 하나로 줄어든다.
- (+) DOM 프로젝트가 클라이언트 배선을 초 단위로 잡는다 — 지금은 e2e 뿐이라 D1 픽스처 공유
  간섭(`fullyParallel`)까지 겹쳐 있었다.
- (−) 번들 크기가 늘어난다(`xstate`+`@xstate/react`) — 실측(#80, `submit` 머신 5곳 배선):
  `.next/static/chunks/*.js` 총합이 914,751 → 956,746 bytes, **+41,995 bytes(약 41KB)**.
  머신 도입 자체(사용처 0)는 tree-shaking으로 델타가 0이었다 — 늘어난 건 실제로 5곳이
  `xstate`/`@xstate/react`를 import 해 번들에 들어간 시점부터다.
- (−) 부수효과를 core 밖 `*.actor.ts` 로 빼는 규약이 하나 늘어난다 — 안 지키면 core 가
  순수를 잃어 workerd 단위 테스트가 죽는다.
