"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ANGLE, axis, PATTERNS, ROT, sortGameCards } from "@/core/games";
import type { GameCard } from "@/features/games/service";
import type { SuggestionListItem } from "@/features/suggestions/service";
import { trpc } from "@/features/trpc/client";
import { GameComposer } from "./game-composer";
import { GameDeleteConfirm } from "./game-delete-confirm";
import { GameDetail } from "./game-detail";
import { GameEditor } from "./game-editor";
import { REQUEST_TIMEOUT_MS } from "./error-message";
import { SuggestDialog } from "./suggest-dialog";
import { SuggestionInbox } from "./suggestion-inbox";

/* 게임 보드. 목록의 정본은 D1 이다 — 서버 컴포넌트(page.tsx)가 읽어 props 로 넘기고, 여기선
   쓰기(추가·날짜 수정·삭제)를 한다. 쓰기는 tRPC 뮤테이션(서버 인가가 정본)을 부르고 로컬
   상태를 낙관적으로 갱신한다. canWrite/canDelete 는 버튼 노출용 편의일 뿐 — 권한 없이 눌러도
   서버가 FORBIDDEN 으로 막는다(불변식 3). localStorage 다중탭 경합은 서버 권위로 사라졌다.

   상태 필터 줄이 있었다. status 컬럼이 사라지며 같이 없앴다 — 걸러 볼 축이 날짜뿐인데
   서버 정렬이 이미 플레이한 날 내림차순이라, 필터는 같은 정보를 두 번째 조작으로 되풀이했다.

   ── 격자는 표지·이름·클리어까지만 싣는다 ──────────────────────────────────────
   카드마다 날짜 한 줄과 수정·삭제 버튼 둘이 서 있었다. 8장이면 아이콘만 16개고, 그 대부분은
   **아무도 지금 쓰지 않는다** — 보드를 여는 이유는 "뭘 했나 훑기"지 고치기가 아니다. 부수
   정보와 조작을 카드를 눌러야 나오는 상세로 내리면 격자가 사진과 이름만 말하고, 고치려는
   사람은 고칠 카드 하나를 이미 고른 뒤에 조작을 만난다.

   클리어 칩만 앞면에 남긴다: "이 게임을 깼나"는 훑는 눈이 던지는 질문이라 카드마다 열어 보게
   하면 안 되고, 날짜와 달리 한 글자로 답이 된다. 정확한 날짜는 상세가 답한다.

   쓰기 권한이 없으면 추가 슬롯 자리에 **아무것도 그리지 않는다.** 잠긴 칸도, 보드 뒤 각주도
   두지 않는다: "방문자는 자기가 못 하는 걸 알아야 한다"는 근거가 언젠가 권한을 가질 사람에게만
   성립하는데, core/authorities.ts 에 member 역할이 없어 일반 팬은 영원히 쓰기를 못 얻는다.
   취할 조치가 없는 안내는 화면 어디에 두든 읽는 사람의 시간만 쓴다. 권한 모델이 바뀌어
   member 가 생기면(이슈 #22) 그때 다시 판단한다 — 그 전까진 보드가 게임만 보여주는 게 맞다.
   **상세는 권한과 무관하게 열린다** — 거기 담긴 날짜는 공개 목록이 이미 실어 보낸 값이고,
   앞면에서 뺀 정보를 권한 뒤에 숨기면 로그아웃 방문자는 볼 수 있던 것을 잃는다.

   삭제는 **확인이 먼저**다(ADR-0020): 클릭은 확인 모달을 열 뿐이고, remove 뮤테이션은 사용자가
   확인을 누른 순간 곧바로 나간다. 한때는 자국(ghost) + 6초 되돌리기 창이었는데, 그 6초 동안
   카드가 "뗀 것도 아직 있는 것도 아닌" 상태로 보드에 남아 세는 집합(총계)과 그리는 집합(빈 상태)
   이 갈렸다. 확인이 파괴 앞에 서면 그 중간 상태 자체가 없어져 둘이 다시 하나가 된다.
   하드 삭제(games 에 deleted_at 없음)는 그대로고, 근거만 "되돌리기가 서버를 안 건드린다"에서
   "파괴 전에 확인을 받는다"로 갈아 끼웠다. */

// --rest-rot/--thumb-a 같은 CSS 커스텀 속성을 인라인 style 로 넘길 때의 타입 우회.
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/* 방금 추가한 카드의 강조 링(.game--just-added, games.css)이 스스로 걷히기까지 기다리는
   시간. 화면을 훑어 카드를 찾기엔(정렬이 카드를 뒤로 보내 스크롤이 필요할 수 있다) 충분하고,
   그보다 오래 남으면 "이 카드가 특별하다"는 잘못된 인상을 준다. */
const JUST_ADDED_MS = 2000;

/* 컴포저를 여는 방식 두 가지. 빈 객체는 평소의 「게임 추가」이고, initial 이 붙으면 팬의
   추가 요청을 반영하려고 그 이름·값으로 채워 여는 길이다(ADR-0025). */
type ComposerOpen = { initial?: React.ComponentProps<typeof GameComposer>["initial"] };

export function GameBoard({
  initialGames,
  canWrite,
  canDelete,
  signedIn,
  initialPending,
}: {
  initialGames: GameCard[];
  canWrite: boolean;
  canDelete: boolean;
  /* 로그인했는가 — **제안 진입점이 이 값으로 갈린다**(ADR-0025). 한때 보드는 신원을 아예 안
     받았고 근거는 "member 역할이 없어 로그인해도 얻는 게 없다"였는데(이슈 #22), 제안이 그
     전제를 뒤집었다: 이제 로그인한 사람만 할 수 있는 일이 실재한다. */
  signedIn: boolean;
  // 미처리 제안 수(관리자만). 서버가 세어 넘겨야 배지가 첫 페인트에 뜬다.
  initialPending: number;
}) {
  const [games, setGames] = useState(initialGames);
  const [announcement, setAnnouncement] = useState("");
  /* 컴포저를 여는 신호이자 그 출발점. 불리언이 아닌 이유는 팬의 **추가 요청을 반영**할 때
     제안 값을 채워 열기 때문이다 — 두 상태로 갈라 두면 "열렸는데 값이 안 채워진" 조합이
     표현 가능해진다(연 주체와 값이 한 사실이라 한 상태로 둔다). */
  const [composing, setComposing] = useState<ComposerOpen | null>(null);
  /* 제안 폼을 연 대상. GameCard = 그 카드의 수정 제안, "add" = 보드에 없는 게임 추가 요청. */
  const [suggesting, setSuggesting] = useState<GameCard | "add" | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [pending, setPending] = useState(initialPending);
  /* 지금 **반영 중인** 제안. 폼이 저장에 성공하면 이 제안을 accepted 로 표시한다 — 두 요청이
     원자가 아닌 건 알고 받는 한계다(결정 2): 표시가 실패해도 남는 상태는 "제안함에 줄이
     남음"뿐이고, 게임은 이미 반영됐으며 관리자가 다시 보고 처리하면 끝난다. */
  const [applying, setApplying] = useState<SuggestionListItem | null>(null);
  /* 열어 둔 카드. 수정·삭제는 **이 위에 겹쳐** 뜬다(닫고 여는 게 아니다) — 그래야 취소했을 때
     상세로 돌아오고, 포커스 복원을 브라우저의 dialog 스택이 그대로 맡는다. 행 전체를 들고
     있는 이유는 아래 editing 과 같다. */
  const [detail, setDetail] = useState<GameCard | null>(null);
  /* 상세에 보내는 "이제 닫아라" 신호. 쓰는 길은 **삭제 성공** 하나다(onRemoved) — 나머지 닫는
     길은 셸이 스스로 처리하고, 뒤로가기도 이제 셸이 받는다(GameDialog 의 history). 이 신호를
     거치는 이유는 곧장 언마운트하면 dialog 가 열린 채 DOM 에서 빠져 close 이벤트가 아예 안
     오기 때문이다 — 그러면 셸이 히스토리 엔트리를 되돌릴 자리를 잃는다. */
  const [detailClosing, setDetailClosing] = useState(false);
  /* 이번 닫힘이 **삭제 때문인가.** 포커스를 어디로 넘길지가 여기서 갈린다(onDetailClosed).
     state 가 아니라 ref 인 이유: 이 값이 바뀐다고 다시 그릴 것이 없고, 닫기 신호를 세우는
     같은 tick 에 쓰고 close 이벤트에서 읽는 자리라 리렌더를 기다리면 늦는다. */
  const detailRemovedRef = useRef(false);
  // 고치는 중인 행(플레이 날짜·클리어). 행 전체를 들고 있는 이유: 모달이 제목·포스터로
  // "무엇을 고치는지"를 다시 보여줘야 하고, id 만 들면 목록에서 매번 되찾아야 한다.
  const [editing, setEditing] = useState<GameCard | null>(null);
  // 삭제 확인을 받는 중인 행. editing 과 같은 이유로 행 전체를 든다 — 모달이 포스터·제목으로
  // "무엇을 떼는지"를 되짚어 줘야 하고, 되돌릴 수 없는 행동일수록 그 확인이 정확해야 한다.
  const [deleting, setDeleting] = useState<GameCard | null>(null);
  const addSlotRef = useRef<HTMLButtonElement>(null);
  /* 방금 붙인 카드. 정렬이 그 카드를 어디로 보내든 사용자가 그것을 찾을 수 있어야 한다(아래
     onAdded 주석) — 포커스 이동과 강조 링(.game--just-added, games.css) 둘 다 이 id 하나로
     켠다. */
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const justAddedRef = useRef<HTMLButtonElement | null>(null);

  function onAdded(row: GameCard) {
    /* **정렬해서 넣는다.** 한때 맨 앞에 붙였고(구 보드의 prepend) 근거는 "방금 붙인 카드는
       눈에 보이는 자리에 있어야 한다"였는데, 그 근거가 정렬을 이길 수 있었던 건 추가 폼이
       날짜를 안 받던 시절뿐이다. 지금은 과거 날짜를 실어 소급 입력하는 게 정상 경로라
       (addGameInput 주석), prepend 하면 2026-01-05 짜리 카드가 최근 플레이 위에 앉는다 —
       보드가 "플레이한 날 내림차순"이라고 스스로 말하는 자리에서 그건 틀린 그림이고,
       새로고침 한 번에 카드가 다른 데로 튄다(적대적 리뷰가 잡았다).

       onUpdated 가 같은 이유로 이미 정렬한다 — 두 쓰기 경로가 다른 규칙을 쓸 이유가 없다. */
    setGames((prev) => sortGameCards([row, ...prev]));
    setComposing(null);
    setAnnouncement(row.categoryValue + " 추가됨");
    void markApplied();
    /* 정렬이 카드를 화면 밖으로 보낼 수 있으므로(날짜를 안 넣으면 날짜 있는 게임들 뒤로
       간다) 그 카드로 포커스를 옮긴다. 스크롤이 아니라 포커스인 이유: 스크롤만 하면 키보드
       사용자는 뷰포트와 포커스가 갈린 채 남는다(모달이 닫히며 포커스는 추가 슬롯으로
       복원된다). focus() 가 스크롤도 함께 하므로 시각 사용자에게도 같은 결과다.

       포커스만으로는 부족하다 — 마우스로 추가하면 :focus-visible 이 안 떠 아무 표시도 없다
       (아래 강조 링 effect 주석). justAdded 하나가 포커스 이동과 그 표시(.game--just-added)
       를 함께 켠다. */
    setJustAdded(row.id);
  }

  /* 위 setJustAdded 의 짝. effect 안에서 상태를 안 건드리므로 set-state-in-effect 규칙에
     걸리지 않는다. 모달이 닫히며 브라우저가 추가 슬롯으로 되돌린 포커스를 여기서 덮는다 —
     close 이벤트가 리렌더보다 먼저라 이 effect 가 나중이다. */
  useEffect(() => {
    if (justAdded === null) return;
    justAddedRef.current?.focus();
  }, [justAdded]);

  /* 강조 링을 스스로 건다. setTimeout 콜백 안의 setState 라 effect 안 **동기** setState 를
     막는 규칙(set-state-in-effect)에 안 걸린다. 타이머로 클래스를 통째로 떼는 게 계약이라
     트랜지션이 없고, 그래서 reduced-motion 가드도 따로 안 붙는다(games.css 의 .game--just-added
     주석). 언마운트·재추가(justAdded 가 다른 id 로 바뀜) 둘 다 cleanup 이 정리한다 — 안 하면
     먼저 추가한 카드의 타이머가 나중에 추가한 카드의 링을 꺼 버린다. */
  useEffect(() => {
    if (justAdded === null) return;
    const timer = setTimeout(() => setJustAdded(null), JUST_ADDED_MS);
    return () => clearTimeout(timer);
  }, [justAdded]);

  /* 상세가 실제로 닫힌 뒤(브라우저의 close 이벤트). 닫은 주체가 누구든 여기로 모인다.
     히스토리 엔트리 되돌리기는 여기 없다 — 셸이 같은 이벤트에서 이미 한다(GameDialog). */
  function onDetailClosed() {
    setDetail(null);
    setDetailClosing(false);
    if (!detailRemovedRef.current) return;
    detailRemovedRef.current = false;
    /* 삭제로 닫힌 길만 포커스를 옮긴다. 브라우저는 포커스를 트리거로 되돌리는데 그 트리거는
       방금 지운 카드라 함께 사라졌다 — 그대로 두면 body 로 떨어져 키보드 사용자가 탭 순서 맨
       앞으로 튕긴다. 붙이기 슬롯은 카드가 아니라 그리드의 고정 첫 칸이라 지워지지 않으므로
       여기로 넘긴다(삭제 권한이 있으면 쓰기 권한도 있다 — core/authorities). */
    addSlotRef.current?.focus();
  }

  /* 상세 **위에** 겹친 모달이 떠 있는가. 뒤로가기가 왔을 때 셸이 무엇을 할지가 여기서 갈린다
     (GameDialog 의 covered) — 셸은 자기 위에 뭐가 얹혔는지 못 보므로 보드가 알려 준다. */
  const detailCovered = editing !== null || deleting !== null || suggesting !== null;

  /* 제안함의 「반영하기」 — 제안함을 닫고 **기존 폼**을 제안 값으로 채워 연다. 여기서 게임을
     직접 쓰지 않는 게 이 설계의 핵심이다(결정 2): 저장은 평소의 add/update 경로가 하고, 이
     함수는 그 폼의 출발점만 정한다. */
  function onApplySuggestion(item: SuggestionListItem) {
    setInboxOpen(false);
    setApplying(item);
    const values = {
      playedDate: item.proposed.playedDate ?? "",
      cleared: item.proposed.cleared,
      clearedDate: item.proposed.clearedDate ?? "",
    };
    if (item.kind === "add") {
      // 자유 이름을 검색어로 넣는다 — 정본 카테고리·표지는 관리자가 그 결과에서 고른다.
      setComposing({ initial: { query: item.proposedTitle ?? "", ...values } });
      return;
    }
    const game = games.find((g) => g.id === item.gameId);
    if (!game) {
      // 제안함을 열어 둔 사이 그 게임이 지워졌다 — 열 폼이 없으므로 정직하게 말하고 멈춘다.
      setApplying(null);
      setAnnouncement("그 게임이 보드에 없습니다 — 새로고침해 주십시오");
      return;
    }
    setEditing(game);
  }

  /* 날짜를 고치면 lastPlayed 가 바뀌어 **자리도 달라져야 한다** — 제자리 교체만 하면 새로고침
     전까지 보드가 날짜순이 아닌 채로 남는다. 정렬 규칙은 core 가 쥔다(서버 SQL 의 짝). */
  function onUpdated(row: GameCard, meta: { dateApplied: boolean }) {
    setGames((prev) => sortGameCards(prev.map((g) => (g.id === row.id ? row : g))));
    setEditing(null);
    /* 상세가 아래 열려 있으면 그 화면도 새 값으로 갈아 끼운다 — 안 하면 방금 고친 날짜가
       돌아온 화면에 옛 값으로 떠 "저장이 안 됐다"로 읽힌다. */
    setDetail((prev) => (prev && prev.id === row.id ? row : prev));
    setAnnouncement(row.categoryValue + " 수정됨");
    void markApplied(meta.dateApplied);
  }

  /* 반영이 끝났으니 그 제안을 accepted 로 표시한다. **게임 쓰기와 별개 요청이다** — 묶으면
     제안 처리가 games 쓰기 계약 안으로 들어와 승인 전용 경로가 생긴다(결정 2가 막으려는 것).

     실패해도 사용자에게 던지지 않는다: 반영 자체는 성공했고(보드가 이미 바뀌었다) 남은 문제는
     제안함에 줄이 남는 것뿐이라, 여기서 오류를 띄우면 방금 성공한 저장이 실패로 읽힌다.
     대신 라이브 영역으로 알려 관리자가 제안함에서 직접 정리할 수 있게 한다. */
  async function markApplied(dateApplied = true) {
    if (!applying) return;
    const target = applying;
    setApplying(null);
    /* **날짜를 못 실었으면 처리로 표시하지 않는다.** 여러 날 편성이라 폼이 날짜를 잠근 경우가
       그렇다 — 클리어만 저장됐는데 제안이 제안함에서 사라지면 팬의 날짜 제안이 조용히 증발한다
       (리뷰가 잡았다). 제안을 미처리로 남겨 두면 관리자가 /schedule 에서 날짜를 고친 뒤 다시
       반영할 수 있고, 왜 남았는지는 라이브 영역이 말한다. */
    if (!dateApplied) {
      setAnnouncement(
        "클리어만 반영했습니다 — 여러 날 편성이라 날짜는 일정에서 고쳐 주십시오. 제안은 그대로 뒀습니다",
      );
      return;
    }
    try {
      /* **resolved 를 읽는다.** 서버는 미처리인 것만 고치므로(CAS), 제안함을 열어 둔 사이 다른
         관리자가 같은 줄을 먼저 처리했으면 false 가 온다. 그때 배지를 또 줄이면 이미 남이 줄인
         수에서 한 번 더 빠져 화면이 어긋나고, 더 나쁘게는 관리자가 **자기가 처리했다고 믿는다.**

         저장 자체는 되돌리지 않는다 — 그건 이 관리자가 폼에서 값을 보고 확정한 쓰기이고, 제안이
         거절됐든 아니든 그에겐 그럴 권한이 있다(카드를 그냥 열어 고쳐도 같은 결과다). 제안은 그
         값의 출처일 뿐 쓰기 주체가 아니라는 게 결정 2 의 요지다. 그러니 되돌릴 게 아니라
         **사실을 알린다.** */
      const { resolved } = await trpc.suggestions.resolve.mutate(
        { id: target.id, resolution: "accepted" },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (resolved) setPending((n) => Math.max(0, n - 1));
      else setAnnouncement("저장했습니다 — 그 제안은 다른 관리자가 이미 처리했습니다");
    } catch {
      setAnnouncement("반영은 됐지만 제안함 표시를 못 바꿨습니다 — 제안함에서 확인해 주십시오");
    }
  }

  /* 삭제가 서버까지 끝난 뒤. 모달이 닫힌 다음에 불린다(GameDeleteConfirm 의 인계 규약). */
  function onRemoved(row: GameCard) {
    setGames((prev) => prev.filter((g) => g.id !== row.id));
    setDeleting(null);
    setAnnouncement(row.categoryValue + " 삭제됨");
    /* 상세는 방금 사라진 게임을 보여주고 있었다 — 같이 닫는다. **곧장 언마운트하지 않고 닫기
       신호를 세운다**: 그래야 브라우저의 close 이벤트가 오고, 셸이 거기서 히스토리 엔트리를
       되돌린다(안 되돌리면 삭제하고 나온 사람의 뒤로가기 한 번이 아무 일도 안 한다).
       그 대가인 "포커스가 body 로 떨어짐"은 onDetailClosed 가 추가 슬롯으로 갚는다 —
       포커스가 돌아갈 트리거(카드)는 어차피 같은 커밋에서 사라진다. */
    detailRemovedRef.current = true;
    setDetailClosing(true);
  }

  return (
    <>
      {/* HEAD */}
      <section className="head" data-od-id="play-log-head">
        <div className="wrap">
          <div className="head__row">
            <h1 data-od-id="play-log-title">플레이한 게임</h1>
            {/* 총계는 목록 그 자체다 — 지연 커밋 시절엔 "아직 안 지운 자국"을 빼느라 세는
                집합과 그리는 집합이 갈렸지만, 확인이 파괴 앞으로 오면서 games 하나로 합쳐졌다. */}
            <span className="head__count">
              총 <b>{games.length}</b>개
            </span>
          </div>
          {/* 설명 한 줄이 여기 있었다. 제목("플레이한 게임")과 총계가 이미 같은 말을 하고
              있어서, 보드에 닿기 전 한 줄을 더 읽히는 값이 없었다. */}

          {/* 보드 전체에 걸리는 조작 둘. 카드 하나에 매인 게 아니라 여기 산다 — 「게임 추가」가
              그리드 첫 칸의 빈 폴라로이드인 것과 갈리는 지점이다(그건 "한 장 더 붙인다"는
              은유라 격자 안이 제자리고, 이 둘은 격자 밖의 일이다).

              비로그인에겐 아무것도 안 그린다. 취할 조치가 없는 안내는 화면 어디에 두든 읽는
              사람의 시간만 쓴다는 판단 그대로다(추가 슬롯을 안 그리는 것과 같은 근거) — 다만
              카드 상세에는 한 줄을 둔다. 거기선 "이거 틀렸네"를 방금 본 사람이라 로그인이
              **취할 수 있는 조치**가 된다. */}
          {(canWrite || signedIn) && (
            <div className="head__acts">
              {canWrite && (
                <button
                  className="btn btn--secondary head__act"
                  type="button"
                  data-od-id="inbox-open"
                  onClick={() => setInboxOpen(true)}
                >
                  들어온 제안
                  {/* 0 건이면 배지를 안 그린다 — 빈 수를 보여 주면 매번 확인하게 만든다.
                      숫자는 장식이 아니라 조작 이름의 일부라 aria-hidden 을 안 건다. */}
                  {pending > 0 && (
                    <span className="head__badge" data-od-id="inbox-badge">
                      {pending}
                    </span>
                  )}
                </button>
              )}
              {/* 관리자는 직접 추가하면 되므로 자기에게 요청할 이유가 없다. */}
              {signedIn && !canWrite && (
                <button
                  className="btn btn--secondary head__act"
                  type="button"
                  data-od-id="suggest-add-open"
                  onClick={() => setSuggesting("add")}
                >
                  게임 추가 요청
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {composing && (
        <GameComposer
          initial={composing.initial}
          onAdded={onAdded}
          onClose={() => {
            setComposing(null);
            // 반영을 도중에 접었다 — 제안은 미처리로 남는다(관리자가 다시 열 수 있다).
            setApplying(null);
          }}
        />
      )}
      {detail && (
        <GameDetail
          game={detail}
          canWrite={canWrite}
          canDelete={canDelete}
          signedIn={signedIn}
          closing={detailClosing}
          covered={detailCovered}
          onEdit={() => setEditing(detail)}
          onDelete={() => setDeleting(detail)}
          onSuggest={() => setSuggesting(detail)}
          onClose={onDetailClosed}
        />
      )}
      {suggesting && (
        <SuggestDialog
          game={suggesting === "add" ? null : suggesting}
          stacked={detail !== null}
          onSent={(message) => {
            setSuggesting(null);
            setAnnouncement(message);
            /* **아래 상세도 함께 닫는다.** 제안을 보내고 나면 그 카드에서 할 일이 끝났는데,
               안 닫으면 성공 화면 뒤로 상세가 남아 카드 두 장이 겹쳐 보인다(사용자 지적).
               취소하고 돌아갈 자리가 필요한 수정·삭제와 다른 지점이다 — 저쪽은 되돌아갈 값이
               있지만 여기선 이미 보냈다.

               곧장 언마운트하지 않고 닫기 신호를 세우는 건 셸이 히스토리 엔트리를 되돌릴
               자리를 잃지 않게 하려는 것이다(onRemoved 와 같은 규약). 추가 요청은 보드 상단에서
               열려 상세가 없으므로 그때 신호를 세우면 **다음에 여는 상세가 즉시 닫힌다** —
               열려 있을 때만 세운다. */
            if (detail) setDetailClosing(true);
          }}
          onClose={() => setSuggesting(null)}
        />
      )}
      {inboxOpen && (
        <SuggestionInbox
          games={games}
          pending={pending}
          onApply={onApplySuggestion}
          onResolved={() => setPending((n) => Math.max(0, n - 1))}
          onClose={() => setInboxOpen(false)}
        />
      )}
      {/* 상세가 아래 열려 있으면 스크림을 한 겹 더 깔지 않는다(GameDialog 의 className). */}
      {editing && (
        <GameEditor
          game={editing}
          stacked={detail !== null}
          /* 반영 중인 제안이 **이 게임의 것일 때만** 값을 채운다 — id 를 안 대조하면 추가 요청을
             반영하려다 취소하고 다른 카드를 수정할 때 남의 제안 값이 폼에 실린다.

             **채우는 건 입력값뿐이고 precondition 은 안 건드린다**(GameEditor 의 조회 주석).
             그리고 그 보호는 플레이 날짜에만 붙는다 — 클리어는 precondition 없이 늘 실리므로
             폼이 열린 뒤 딴 데서 바뀌면 저장이 덮는다. 기존 수정 폼의 성질을 그대로 물려받은
             것이라 여기서 갈라 고치지 않는다(ADR-0025 결정 2 의 보호 범위 절). */
          initial={
            applying && applying.gameId === editing.id
              ? {
                  cleared: applying.proposed.cleared,
                  clearedDate: applying.proposed.clearedDate ?? "",
                  playedDate: applying.proposed.playedDate ?? "",
                }
              : undefined
          }
          onUpdated={onUpdated}
          onClose={() => {
            setEditing(null);
            setApplying(null);
          }}
        />
      )}
      {deleting && (
        <GameDeleteConfirm
          game={deleting}
          stacked={detail !== null}
          onRemoved={onRemoved}
          onClose={() => setDeleting(null)}
        />
      )}

      {/* BOARD */}
      <section className="board" aria-labelledby="board-h2">
        <div className="wrap">
          <h2 className="sr-only" id="board-h2">
            게임 목록
          </h2>

          <div className="games" data-od-id="game-grid">
            {/* 붙이기는 드물고 사적인 행동이라 상시 폭을 먹는 접수창구 대신, 그리드 첫 칸에
                빈 폴라로이드 한 장을 꺼내 붙이는 은유. 쓸 수 있는 사람에게만 그린다 — 못 쓰는
                사람에게 남기던 잠긴 칸은 없앴다. 버튼 노출은 편의일 뿐이고 진짜 방어선은
                서버 인가다(불변식 3). */}
            {canWrite && (
              <button
                className="polaroid addslot"
                type="button"
                ref={addSlotRef}
                data-od-id="composer-open"
                onClick={() => setComposing({})}
              >
                {/* 집게까지 받아야 게임 카드와 같은 종족으로 읽힌다 — 빈 종이 한 장을 꺼내
                    같은 줄에 집어 둔 것이지, 다른 부품을 첫 칸에 끼운 게 아니다. */}
                <span className="clip" aria-hidden="true" />
                <span className="addslot__slot" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="addslot__label">게임 추가</span>
              </button>
            )}
            {games.map((g) => {
              // 카드 정체성(기울기·패턴·각도)은 안정 id 해시로 고른다 — 정수 PK 를 문자열로.
              const key = String(g.id);
              const rot = ROT[axis(key, "rot", ROT.length)] ?? ROT[0];
              const ang = ANGLE[axis(key, "ang", ANGLE.length)] ?? ANGLE[0];
              /* 칩이 앞면에 남는 유일한 부수 사실이다. 클리어의 정본은 플래그다
                 (cleared_date 유무가 아니다 — "깼는데 날짜 모름"을 살린다). */
              return (
                <div
                  key={g.id}
                  className={"polaroid game" + (g.id === justAdded ? " game--just-added" : "")}
                  style={cssVars({ "--rest-rot": rot, "--thumb-a": ang })}
                  data-od-id={"game-card-" + g.id}
                >
                  <span className="clip" aria-hidden="true" />
                  <div
                    className="game__thumb"
                    data-p={axis(key, "pat", PATTERNS)}
                    aria-hidden="true"
                  >
                    {g.posterImageUrl ? (
                      <img
                        className="game__poster"
                        src={g.posterImageUrl}
                        alt=""
                        loading="lazy"
                        width={180}
                        height={240}
                      />
                    ) : (
                      <>
                        <span className="game__initial">{g.categoryValue.charAt(0)}</span>
                        <svg>
                          <use href="#mk-paw" />
                        </svg>
                      </>
                    )}
                  </div>
                  <div className="game__body">
                    {/* 카드 전체가 한 번에 눌린다. 그 히트 영역은 **제목 버튼이 ::after 로
                        카드를 덮어서** 만든다 — 카드 자체를 button 으로 만들면 그 안에 h3 이
                        못 들어가(button 의 콘텐츠 모델) 보드가 제목 없는 이미지 더미가 되고,
                        투명 오버레이를 형제로 따로 깔면 접근 이름이 없는 버튼이 하나 더 는다.
                        이 방식은 눌리는 것과 이름이 같은 요소라 스크린리더·키보드에서도 하나다.

                        접근 이름에 "자세히"를 더한다 — 이름만이면 버튼이 무엇을 하는지 안 말한다.
                        시각 라벨(게임명)을 그대로 품으므로 WCAG 2.5.3(Label in Name)은 지켜진다. */}
                    <h3 className="game__name">
                      <button
                        className="game__open"
                        type="button"
                        aria-label={g.categoryValue + " 자세히"}
                        data-od-id={"game-open-" + g.id}
                        // 방금 붙인 카드에만 걸린다 — 정렬 뒤 그 카드를 찾아 주는 손잡이다.
                        ref={g.id === justAdded ? justAddedRef : undefined}
                        // 히스토리 엔트리는 여는 쪽이 아니라 셸이 쌓는다(GameDialog 의 history).
                        onClick={() => setDetail(g)}
                      >
                        {/* 두 줄 말줄임은 이 span 이 진다 — 버튼에 직접 걸면 함께 필요한
                            overflow:hidden 이 카드를 덮는 ::after 까지 잘라 히트 영역이
                            글자 크기로 쪼그라든다(games.css). */}
                        <span className="game__nametext">{g.categoryValue}</span>
                      </button>
                    </h3>
                    {g.cleared && (
                      <p className="game__meta" data-od-id={"game-meta-" + g.id}>
                        <span className="chip chip--ok">클리어</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {games.length === 0 && (
            <div className="grid-empty" data-od-id="game-grid-empty">
              <span className="t-hand">텅 비었네냥…</span>
              <span>아직 등록된 게임이 없습니다.</span>
            </div>
          )}

          <p className="sr-only" role="status">
            {announcement}
          </p>
        </div>
      </section>
    </>
  );
}
