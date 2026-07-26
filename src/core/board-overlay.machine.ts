import { assign, cancel, raise, setup } from "xstate";
import { sortGameCards } from "./games";

/* 게임 보드 오버레이 스택 머신(에픽 #77 이슈 #81) — `GameBoard` 가 들고 있던 `useState` 6개 +
   `useRef` 1개(composing·detail·suggesting·inboxOpen·editing·deleting·detailRemovedRef)와
   그 위에 손으로 복붙되던 파생값(`stacked={detail!==null}` 3곳, `detailCovered = editing ||
   deleting || suggesting`)을 대체한다. 목표는 "불가능 조합이 타입으로 표현 가능하다"는 결함을
   상태차트의 계층·가드로 없애는 것 — 지금은 "그런 setter 를 안 부른다"는 관례가 유일한 방어선이다.

   **화면 대비 타입은 core → features 의존을 만들지 않으려고 전부 제네릭이다**(불변식 1 —
   `GameCard`·`SuggestionListItem` 은 features 레이어에 산다). 그 대신 `submit.machine.ts` 와
   같은 "제네릭 팩토리" 패턴을 그대로 잇는다: 호출자(`src/app/games/game-board.tsx`, PR 10)가
   구체 타입을 채워 인스턴스화한다. 문구·라우팅 판단(제안 종류별 분기, "그 게임이 없다" 판정)도
   전부 호출자가 결정해 이벤트에 실어 보낸다 — 이 머신은 "오버레이 스택이 지금 어디 있는가"만
   알 뿐 그 판단의 근거(제안 종류·게임 목록 조회)를 모른다. */

const JUST_ADDED_TIMER_ID = "board-overlay-just-added";

/* 방금 추가한 카드의 강조 링이 스스로 걷히기까지 기다리는 시간(games.css 의
   .game--just-added 짝). 원래 game-board.tsx 의 JUST_ADDED_MS 를 그대로 옮겼다 — 타이머의
   소유자가 이 머신으로 바뀌었으니 상수도 함께 옮긴다. */
export const JUST_ADDED_MS = 2000;

export type BoardOverlayInput<TGame> = {
  games: TGame[];
  pending: number;
};

type BoardOverlayContext<TGame, TSuggestion, TComposerInitial> = {
  games: TGame[];
  pending: number;
  announcement: string;
  justAdded: number | null;
  // detail 이 열려 있는 동안만(=state.matches("detail")) 의미가 있다.
  detailGame: TGame | null;
  /* detail.editing **또는** applyingEditSuggestion 에서 함께 쓴다 — 아래 applyingEditSuggestion
     상태 주석 참고. 편집기가 지금 무엇을 고치는지는 이 필드 하나로 정해진다(어느 부모를 거쳐
     왔는지와 무관하다). */
  editingGame: TGame | null;
  /* 지금 반영 중인 제안 — composing(반영-추가) 또는 editingGame 이 반영-수정으로 채워졌을 때만
     의미가 있다. 저장 성공/취소 양쪽에서 지운다(원본 game-board.tsx 의 onClose·markApplied
     양쪽에서 setApplying(null) 하던 것과 같다). */
  applying: TSuggestion | null;
  // composing 에서만 의미가 있다.
  composerInitial: TComposerInitial | undefined;
  /* detail 자신의 <dialog> 를 프로그램적으로 닫으라는 신호. 켜지는 경로 둘 — 삭제 성공(GAME_REMOVED)
     과 상세에서 보낸 제안이 성공(SUGGESTION_SENT, "아래 상세도 함께 닫는다"). DETAIL_CLOSED 에서
     되돌린다 — 실제 브라우저 close 가 그 시점에 이미 일어났다. */
  detailClosing: boolean;
  /* DETAIL_CLOSED 뒤 포커스를 추가 슬롯으로 넘기라는 신호 — **삭제로 닫힌 경우만** 켠다(트리거였던
     카드가 삭제로 함께 사라져 브라우저의 기본 포커스 복원이 갈 곳을 잃는다). detailClosing 과
     같은 트리거(GAME_REMOVED)에서 켜지지만 수명이 다르다 — detailClosing 은 DETAIL_CLOSED 가 오면
     이미 쓸모가 없어 그 자리에서 꺼지지만, 이 값은 컴포넌트가 실제로 focus() 를 호출한 뒤에야
     끝나므로 DETAIL_CLOSED 이후에도 한 틱 더 살아 있어야 한다 — 그래서 FOCUS_HANDLED 라는
     별도 이벤트로만 끈다(하나로 합치면 컴포넌트가 읽기 전에 사라진다). */
  focusAddSlot: boolean;
};

type BoardOverlayEvent<TGame, TSuggestion, TComposerInitial> =
  | { type: "OPEN_COMPOSER" }
  | { type: "CLOSE_COMPOSER" }
  | { type: "GAME_ADDED"; row: TGame; announcement: string }
  | { type: "OPEN_DETAIL"; game: TGame }
  | { type: "DETAIL_CLOSED" }
  | { type: "EDIT_FROM_DETAIL" }
  | { type: "CANCEL_EDIT" }
  | { type: "GAME_UPDATED"; row: TGame; announcement: string }
  | { type: "DELETE_FROM_DETAIL" }
  | { type: "CANCEL_DELETE" }
  | { type: "GAME_REMOVED"; row: TGame; announcement: string }
  | { type: "SUGGEST_FROM_DETAIL" }
  | { type: "OPEN_SUGGEST_ADD" }
  | { type: "CANCEL_SUGGEST" }
  | { type: "SUGGESTION_SENT"; announcement: string }
  | { type: "OPEN_INBOX" }
  | { type: "CLOSE_INBOX" }
  /* 제안함의 「반영하기」— 종류·게임 존재 여부에 따른 분기는 호출자가 이미 끝내고 셋 중 하나를
     보낸다(game-board.tsx 의 onApplySuggestion 이 하던 if/else 가 여기로 옮겨온다). */
  | { type: "APPLY_SUGGESTION_ADD"; suggestion: TSuggestion; composerInitial: TComposerInitial }
  | { type: "APPLY_SUGGESTION_EDIT"; suggestion: TSuggestion; game: TGame }
  | { type: "APPLY_SUGGESTION_NOT_FOUND"; announcement: string }
  | { type: "SUGGESTION_RESOLVED" }
  | { type: "ANNOUNCE"; message: string }
  | { type: "FOCUS_HANDLED" }
  | { type: "CLEAR_JUST_ADDED" };

// games 갱신 뒤 정렬까지 함께 하는 두 자리(추가·수정)가 같은 식을 쓴다 — sortGameCards 의 규칙이
// 서버 SQL 정렬의 짝이라는 근거(core/games.ts)를 두 번 다르게 베끼지 않는다.
function replaceAndSort<TGame extends { id: number; lastPlayed: string | null; createdAt: number }>(
  games: TGame[],
  row: TGame,
) {
  return sortGameCards(games.map((g) => (g.id === row.id ? row : g)));
}

export function createBoardOverlayMachine<
  TGame extends { id: number; lastPlayed: string | null; createdAt: number },
  TSuggestion,
  TComposerInitial = unknown,
>() {
  return setup({
    types: {} as {
      context: BoardOverlayContext<TGame, TSuggestion, TComposerInitial>;
      events: BoardOverlayEvent<TGame, TSuggestion, TComposerInitial>;
      input: BoardOverlayInput<TGame>;
    },
  }).createMachine({
    id: "boardOverlay",
    context: ({ input }) => ({
      games: input.games,
      pending: input.pending,
      announcement: "",
      justAdded: null,
      detailGame: null,
      editingGame: null,
      applying: null,
      composerInitial: undefined,
      detailClosing: false,
      focusAddSlot: false,
    }),
    initial: "idle",
    /* 화면·모달이 무엇이든 항상 받는 이벤트 넷. ANNOUNCE·SUGGESTION_RESOLVED 는 markApplied 류
       비동기 후처리가 어느 오버레이가 열려 있든 라이브 영역·배지를 갱신해야 해서(호출자가 언제
       resolve 되는지 이 머신은 모른다), FOCUS_HANDLED·CLEAR_JUST_ADDED 는 아래 각 필드 주석의
       "한 틱 더 살아 있어야 한다"·타이머 재시작 규약의 짝이다. */
    on: {
      ANNOUNCE: { actions: assign({ announcement: ({ event }) => event.message }) },
      SUGGESTION_RESOLVED: {
        actions: assign({ pending: ({ context }) => Math.max(0, context.pending - 1) }),
      },
      FOCUS_HANDLED: { actions: assign({ focusAddSlot: false }) },
      CLEAR_JUST_ADDED: { actions: assign({ justAdded: null }) },
    },
    states: {
      idle: {
        on: {
          OPEN_COMPOSER: {
            target: "composing",
            actions: assign({ composerInitial: undefined }),
          },
          OPEN_DETAIL: {
            target: "detail",
            actions: assign({
              detailGame: ({ event }) => event.game,
              detailClosing: false,
              focusAddSlot: false,
            }),
          },
          OPEN_INBOX: { target: "inbox" },
          OPEN_SUGGEST_ADD: { target: "suggestAdd" },
        },
      },
      composing: {
        on: {
          CLOSE_COMPOSER: {
            target: "idle",
            // 반영을 도중에 접었다 — 제안은 미처리로 남는다(관리자가 다시 열 수 있다).
            actions: assign({ composerInitial: undefined, applying: null }),
          },
          GAME_ADDED: {
            target: "idle",
            actions: [
              assign({
                games: ({ context, event }) => sortGameCards([event.row, ...context.games]),
                announcement: ({ event }) => event.announcement,
                justAdded: ({ event }) => event.row.id,
                composerInitial: undefined,
                applying: null,
              }),
              /* 이전 강조 타이머를 지우고 새로 세운다 — 안 하면 먼저 추가한 카드의 타이머가
                 나중에 추가한 카드의 링을 꺼 버린다(원본 useEffect cleanup 의 계약과 같다).
                 cancel 은 걸린 타이머가 없어도 안전하다(첫 추가). */
              cancel(JUST_ADDED_TIMER_ID),
              raise(
                { type: "CLEAR_JUST_ADDED" },
                { id: JUST_ADDED_TIMER_ID, delay: JUST_ADDED_MS },
              ),
            ],
          },
        },
      },
      inbox: {
        on: {
          CLOSE_INBOX: { target: "idle" },
          APPLY_SUGGESTION_ADD: {
            target: "composing",
            actions: assign({
              applying: ({ event }) => event.suggestion,
              composerInitial: ({ event }) => event.composerInitial,
            }),
          },
          APPLY_SUGGESTION_EDIT: {
            target: "applyingEditSuggestion",
            actions: assign({
              applying: ({ event }) => event.suggestion,
              editingGame: ({ event }) => event.game,
            }),
          },
          // 제안함을 열어 둔 사이 그 게임이 지워졌다 — 열 폼이 없으므로 announcement 만 갱신한다.
          APPLY_SUGGESTION_NOT_FOUND: {
            target: "idle",
            actions: assign({ announcement: ({ event }) => event.announcement }),
          },
        },
      },
      /* **상세 없이 홀로 뜨는 편집기.** 편집기는 원래 detail 의 자식으로만 보이지만(아래 detail.editing),
         제안함의 「반영하기」가 수정 제안을 고르면 detail 을 거치지 않고 곧장 이 상태로 온다
         (game-board.tsx 의 onApplySuggestion 이 detail 을 안 건드리고 setEditing 만 부르던 것과
         같다) — editing 이 이 머신에서 **부모가 둘인 유일한 노드**다(적대적 리뷰가 짚은 자리).
         detail.editing 과 이 상태로 갈라 둔 이유: 하나로 합치려면 editing 을 detail 안에만 두거나
         상태 전체를 parallel 로 쪼개야 하는데, 전자는 "반영하기가 상세도 함께 연다"는 화면 변경이
         되고(계약 위반 — 거동은 한 줄도 안 바뀐다) 후자는 이 머신의 다른 두 오버레이(deleting·
         suggesting)가 실제로는 detail 없이 못 뜨는데도 조합 공간을 20개로 불린다. 그래서 딱 이
         한 자리만 형제로 둔다. GAME_UPDATED·CANCEL_EDIT 의 액션이 detail.editing 과 겹치는 건
         우연이 아니라 같은 폼(GameEditor)의 같은 onClose/onUpdated 콜백이 두 길 모두에서 똑같이
         불리기 때문이다. */
      applyingEditSuggestion: {
        on: {
          CANCEL_EDIT: {
            target: "idle",
            actions: assign({ editingGame: null, applying: null }),
          },
          GAME_UPDATED: {
            target: "idle",
            actions: assign({
              games: ({ context, event }) => replaceAndSort(context.games, event.row),
              announcement: ({ event }) => event.announcement,
              editingGame: null,
              applying: null,
            }),
          },
        },
      },
      detail: {
        initial: "viewing",
        /* 어느 자식에 있든 받는다 — 실제 <dialog> 가 닫힌 뒤(브라우저의 close 이벤트) 여기로
           온다. 닫은 경로가 셸의 자기 닫기(X·배경·Esc·뒤로가기)든 detailClosing 신호로 세운
           프로그램적 닫기든 상관없이 이 하나로 모인다 — 원본 onDetailClosed 와 같다.

           focusAddSlot 을 여기서 안 지운다 — 그 값을 컴포넌트가 읽어 실제 focus() 를 호출한
           뒤에야 FOCUS_HANDLED 로 지운다(위 필드 주석). 여기서 같이 지우면 컴포넌트가 이
           스냅샷을 구경도 못 하고 사라진다. */
        on: {
          DETAIL_CLOSED: {
            target: "idle",
            actions: assign({ detailGame: null, detailClosing: false }),
          },
        },
        states: {
          viewing: {
            on: {
              EDIT_FROM_DETAIL: {
                target: "editing",
                actions: assign({ editingGame: ({ context }) => context.detailGame }),
              },
              DELETE_FROM_DETAIL: { target: "deleting" },
              SUGGEST_FROM_DETAIL: { target: "suggesting" },
            },
          },
          editing: {
            on: {
              CANCEL_EDIT: {
                target: "viewing",
                actions: assign({ editingGame: null, applying: null }),
              },
              GAME_UPDATED: {
                target: "viewing",
                actions: assign({
                  games: ({ context, event }) => replaceAndSort(context.games, event.row),
                  /* 상세가 보여 주는 값도 같이 갈아 끼운다 — 안 하면 방금 고친 날짜가 돌아온
                     화면에 옛 값으로 떠 "저장이 안 됐다"로 읽힌다(원본 onUpdated 와 같다). */
                  detailGame: ({ context, event }) =>
                    context.detailGame && context.detailGame.id === event.row.id
                      ? event.row
                      : context.detailGame,
                  announcement: ({ event }) => event.announcement,
                  editingGame: null,
                  applying: null,
                }),
              },
            },
          },
          deleting: {
            on: {
              CANCEL_DELETE: { target: "viewing" },
              GAME_REMOVED: {
                /* 확인 오버레이는 곧바로 닫는다("viewing" 으로) — 그 자체 <dialog> 는 이미
                   브라우저에서 닫혔다(GameDeleteConfirm 의 onClose 규약). detailClosing 을
                   같은 트랜지션에서 세워 **상세도 함께** 프로그램적으로 닫는다 — 원본이
                   setDeleting(null) + setDetailClosing(true) 를 한 함수(onRemoved)에서 같이
                   하던 것과 같은 원자성이다. */
                target: "viewing",
                actions: assign({
                  games: ({ context, event }) => context.games.filter((g) => g.id !== event.row.id),
                  announcement: ({ event }) => event.announcement,
                  detailClosing: true,
                  focusAddSlot: true,
                }),
              },
            },
          },
          suggesting: {
            on: {
              CANCEL_SUGGEST: { target: "viewing" },
              // 제안을 보내고 나면 그 카드에서 할 일이 끝났으므로 아래 상세도 함께 닫는다
              // (원본 onSent 의 "if (detail) setDetailClosing(true)"). focusAddSlot 은 안 켠다 —
              // 카드 자체는 안 사라지므로 브라우저 기본 포커스 복원(트리거로 복귀)이 맞다.
              SUGGESTION_SENT: {
                target: "viewing",
                actions: assign({
                  announcement: ({ event }) => event.announcement,
                  detailClosing: true,
                }),
              },
            },
          },
        },
      },
      suggestAdd: {
        on: {
          CANCEL_SUGGEST: { target: "idle" },
          SUGGESTION_SENT: {
            target: "idle",
            actions: assign({ announcement: ({ event }) => event.announcement }),
          },
        },
      },
    },
  });
}
