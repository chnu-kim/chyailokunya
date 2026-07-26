"use client";

import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { dateOfInstantKST } from "@/core/calendar";
import { readErrorMessage, REQUEST_TIMEOUT_MS, resolveErrorMessage } from "@/core/error-message";
import { formatDate } from "@/core/games";
import { diffSuggestion, type SuggestionChange } from "@/core/suggestions";
import { createSubmitMachine } from "@/core/submit.machine";
import type { GameCard } from "@/features/games/service";
import { INBOX_LIMIT, type SuggestionListItem } from "@/features/suggestions/service";
import { trpc } from "@/features/trpc/client";
import { BoardOverlay } from "./board-overlay-context";
import { GameDialog } from "./game-dialog";

/* 항목마다 **독립된** 액터를 하나씩 둔다(InboxItem 이 useMachine 을 직접 부른다) — 인박스
   전체가 공유하는 액터 하나였다면 한 줄이 거절 중일 때 다른 줄의 거절이 "제출됨" 상태에서
   무시된다(idle/done 만 submit 을 받는다, submit.machine.ts). 원본(useTransition)은 줄마다
   독립된 프라미스라 이 제약이 없었다 — 같은 부품을 여러 컴포넌트 인스턴스가 나눠 쓰는 건
   XState 의 정상 사용법이라(머신은 설계도, useMachine 이 매번 새 액터를 만든다) 문제없다.
   values 에 wasCapped 를 함께 싣는 이유는 stale-run 규칙 때문이다: run 은 마운트 시점에
   얼어붙어 그때의 items.length 를 못 읽으므로, 클릭 시점에 계산한 값을 실어 보낸다
   (game-editor 의 dateApplied 와 같은 패턴). */
const rejectMachine = createSubmitMachine<
  { id: number; wasCapped: boolean },
  { id: number; resolved: boolean; wasCapped: boolean }
>();

/* 관리자 제안함(ADR-0025). 팬이 보낸 미처리 제안을 모아 보고, 여기서 **반영을 시작한다** —
   시작만 한다: 「반영하기」는 제안 값을 채운 기존 폼(수정 제안 → GameEditor, 추가 요청 →
   GameComposer)을 열 뿐이고 실제 쓰기는 그 폼이 한다. 제안함이 직접 게임을 쓰면 CAS·여러 날
   잠금·주 청구를 쥔 계약이 둘로 갈린다(결정 2).

   **별도 페이지가 아니라 /games 안 모달인 이유**: 반영할 폼이 같은 화면에 있고, 라우트를 늘리면
   routes.ts(nav·푸터·로그인 복귀 허용목록의 공동 정본)까지 딸려 온다 — 관리자에게만 보이는
   페이지를 그 구조에 어떻게 담을지가 새 결정이 되는데, 지금 그 값을 치를 이유가 없다.

   대상 게임의 현재 값은 **보드가 이미 든 목록에서 찾는다**(머신 context.games). 서버가 조인해
   실어 보내지 않는 이유는 그래야 제안함이 그리는 "현재 값"이 바로 뒤 보드가 그리는 값과
   확실히 같아지기 때문이다.

   이 컴포넌트는 board-overlay 머신이 `inbox` 상태일 때만 마운트된다(game-board.tsx). 「반영
   하기」의 종류별 분기(추가 요청 vs 수정 제안 vs 그 게임이 이미 지워짐)는 게임 목록에 접근할
   수 있는 이 파일이 판정해 셋 중 하나의 이벤트로 보낸다 — 머신은 오버레이 모양만 안다
   (board-overlay.machine.ts). */
export function SuggestionInbox() {
  const actorRef = BoardOverlay.useActorRef();
  const games = BoardOverlay.useSelector((s) => s.context.games);
  /* 미처리 제안 **전체** 수(배지가 쓰는 그 값). 목록은 상한이 있어(INBOX_LIMIT) 이 수보다
     짧을 수 있는데, 그 사실을 화면이 말하지 않으면 관리자가 "제안은 이게 전부"로 오해한다. */
  const pending = BoardOverlay.useSelector((s) => s.context.pending);
  const [items, setItems] = useState<SuggestionListItem[] | null>(null);
  // 목록 최초 로드 실패 + 넘친 큐 이어 받기 실패. 거절 자체의 실패·타임아웃은 각 줄이 자기
  // 액터의 context.error 를 인라인으로 그린다(항목마다 독립 액터라 — 위 rejectMachine 주석).
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  /* 어느 줄이든 거절이 진행 중인가 — 모달 잠금(busy)과 「닫기」에 쓴다. 항목마다 독립 액터라
     여기서 직접 못 보고, 각 InboxItem 이 자기 busy 변화를 보고한 걸 모은다. */
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set());
  const anyRejecting = busyIds.size > 0;
  const setItemBusy = useCallback((id: number, busy: boolean) => {
    setBusyIds((prev) => {
      if (prev.has(id) === busy) return prev;
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /* 열릴 때 한 번 불러온다. setState 가 await 뒤에서만 일어나므로 effect 안 **동기** setState 를
     막는 규칙(set-state-in-effect)에 안 걸린다. 처리 뒤 다시 읽는 경로도 이 함수를 쓴다 —
     목록을 채우는 규칙이 두 벌이면 한쪽만 고쳐진 채 남는다. */
  /* **읽기만 하고 상태는 안 건드린다.** setState 까지 여기서 하면 effect 가 그걸 동기로 부르는
     모양이 돼 set-state-in-effect(Next 16 의 error)에 걸린다 — 호출자가 await 뒤에 넣어야 한다. */
  const fetchPending = useCallback(
    () =>
      trpc.suggestions.list.query(undefined, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const found = await fetchPending();
        if (alive) setItems(found);
      } catch (e) {
        if (alive) setError(readErrorMessage(e));
      }
    })();
    // 응답이 늦게 와도 언마운트 뒤엔 상태를 안 건드린다.
    return () => {
      alive = false;
    };
  }, [fetchPending]);

  /* 넘친 큐를 이어 받는 재조회가 두 번 이상 동시에 나갈 수 있다(항목마다 독립 액터라 여러 줄이
     동시에 wasCapped 로 거절될 수 있어서다 — 적대적 리뷰가 잡은 자리). 응답 도착 순서가 호출
     순서와 같으리란 보장이 없어 "마지막에 실행된 setItems 가 이긴다"로 두면 **먼저 던졌지만
     늦게 온** 응답이 나중에 던진(따라서 더 최신인) 응답을 덮어써 방금 처리한 제안이 되살아난다.
     가장 최근에 던진 요청의 번호만 기억해 두고, 응답이 왔을 때 그 번호가 아니면 버린다 —
     늦게 온 검색 응답을 버리는 core/games-composer 의 searchSucceeded 판정과 같은 이유다. */
  const latestFetchSeq = useRef(0);
  /* seq 만으론 부족하다(재리뷰가 잡은 자리) — 재조회 A(캡됨)가 나가 있는 동안 다른 줄 C 가
     **캡 안 걸린** 채(A 가 방금 빠져 나가 items.length 가 상한 밑으로 내려간 상태) 거절되면,
     C 의 거절은 새 재조회를 안 던지므로 seq 로 못 막는다 — A 의 재조회가 서버를 C 의 거절보다
     먼저 조회했다면 그 응답에 C 가 아직 들어 있어, 도착했을 때(seq 는 아직 최신이라 통과) C 를
     되살릴 수 있다. 그래서 **거절이 성공한 id 는 wasCapped 여부와 무관하게 전부** 기억해 두고,
     재조회 응답을 반영할 때 그 집합에 있는 id 를 걸러낸다 — 어느 스냅샷이 오든 우리가 이미
     확실히 아는 사실(그 id 는 처리됐다)을 덮어쓰지 못하게 한다. */
  const resolvedIds = useRef<Set<number>>(new Set());

  /* 거절 성공의 후처리(목록에서 빼기·배지 갱신·넘친 큐 이어 받기) — 어느 항목이든 이 하나로
     받는다(InboxItem 이 자기 액터의 done 을 여기로 인계한다). */
  function onItemRejected(result: { id: number; resolved: boolean; wasCapped: boolean }) {
    resolvedIds.current.add(result.id);
    // 목록에서는 어느 쪽이든 뺀다 — 이미 처리된 줄도 여기 남을 이유가 없다.
    setItems((prev) => (prev ?? []).filter((i) => i.id !== result.id));
    /* **배지는 우리가 실제로 처리했을 때만 줄인다.** 서버는 미처리인 것만 고치므로(CAS)
       다른 관리자가 먼저 처리했으면 false 가 오는데, 그때도 줄이면 이미 남이 줄인 수에서
       한 번 더 빠져 배지가 실제 미처리 수보다 작아진다. */
    if (result.resolved) actorRef.send({ type: "SUGGESTION_RESOLVED" });
    // 넘친 큐를 여기서 이어 받는다. 안 넘쳤으면 왕복을 아낀다(대부분의 실사용이 그쪽이다).
    // 이 읽기가 실패해도 거절은 이미 성공했다 — "거절 실패"로 말하면 거짓이 되므로 별도
    // 문구를 쓴다(화면은 한 줄 줄어든 채 남고, 다시 열면 채워진다).
    if (result.wasCapped) {
      const seq = ++latestFetchSeq.current;
      void (async () => {
        try {
          const found = await fetchPending();
          if (latestFetchSeq.current === seq) {
            setItems(found.filter((i) => !resolvedIds.current.has(i.id)));
            // 이 재조회가 실패해 남긴 낡은 문구가 있다면 지운다 — 방금 성공했으므로 화면이
            // 여전히 "불러오지 못했다"고 말하면 이미 거짓이다(review 4라운드가 잡은 자리).
            setError("");
          }
        } catch {
          if (latestFetchSeq.current === seq) {
            setError("다음 제안을 불러오지 못했습니다 — 닫았다 열면 이어서 보입니다.");
          }
        }
      })();
    }
  }

  /* 「반영하기」 — 제안함을 닫고 **기존 폼**을 제안 값으로 채워 연다(머신의 composing 또는
     applyingEditSuggestion 으로 전이). 여기서 게임을 직접 쓰지 않는 게 이 설계의 핵심이다
     (결정 2): 저장은 평소의 add/update 경로가 하고, 이 함수는 그 폼의 출발점만 정한다. */
  function onApply(item: SuggestionListItem) {
    const values = {
      playedDate: item.proposed.playedDate ?? "",
      cleared: item.proposed.cleared,
      clearedDate: item.proposed.clearedDate ?? "",
    };
    if (item.kind === "add") {
      // 자유 이름을 검색어로 넣는다 — 정본 카테고리·표지는 관리자가 그 결과에서 고른다.
      actorRef.send({
        type: "APPLY_SUGGESTION_ADD",
        suggestion: item,
        composerInitial: { query: item.proposedTitle ?? "", ...values },
      });
      return;
    }
    const game = games.find((g) => g.id === item.gameId);
    if (!game) {
      // 제안함을 열어 둔 사이 그 게임이 지워졌다 — 열 폼이 없으므로 정직하게 말하고 멈춘다.
      actorRef.send({
        type: "APPLY_SUGGESTION_NOT_FOUND",
        announcement: "그 게임이 보드에 없습니다 — 새로고침해 주십시오",
      });
      return;
    }
    actorRef.send({ type: "APPLY_SUGGESTION_EDIT", suggestion: item, game });
  }

  return (
    <GameDialog
      title="들어온 제안"
      odId="suggestion-inbox"
      className="composer--detail"
      closing={closing}
      busy={anyRejecting}
      // 본문에 「닫기」가 있으므로 모서리 X 를 끈다 — 같은 일을 하는 손잡이 둘이 한 화면에
      // 있으면 사용자가 차이를 찾느라 멈춘다(GameDialog 의 closeButton 규약).
      closeButton={false}
      onClose={() => actorRef.send({ type: "CLOSE_INBOX" })}
    >
      {items === null && !error && <p className="composer__hint">불러오는 중입니다…</p>}

      {items !== null && items.length === 0 && (
        <p className="composer__hint" data-od-id="inbox-empty">
          아직 온 제안이 없습니다.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="inbox" data-od-id="inbox-list">
          {items.map((item) => (
            <InboxItem
              key={item.id}
              item={item}
              game={games.find((g) => g.id === item.gameId) ?? null}
              /* 지금 화면이 **상한에 걸려 있었나**(처리 전 기준) — 걸려 있었다면 한 줄을 비운
                 자리에 다음 제안이 올라와야 한다(적대적 리뷰 5라운드 — 상한을 넣은 4라운드
                 수정이 만든 자리다). 클릭 시점이 아니라 렌더마다 다시 재는 이유는 이 값이
                 stale-run 규칙에 따라 submit 이벤트의 values 로 실려야 해서다 — InboxItem 은
                 이 값을 매번 최신으로 받는다. */
              wasCapped={items.length >= INBOX_LIMIT}
              /* 닫기는 **부모가 한다** — 여기서 closing 신호를 세우면 부모가 같은 tick 에
                 언마운트하는 것과 겹쳐 close 이벤트가 안 온다. 겹쳐 띄우지 않는 이유는 따로
                 있다: 반영 폼이 그 자체로 취소·미저장 확인을 쥐고 있어 세 겹(제안함 → 폼 →
                 미저장 확인)이 되는데, ADR-0023 이 "여기서 더 깊어지면 구조를 다시 본다"고
                 그은 선이 정확히 세 겹이다. */
              onApply={() => onApply(item)}
              onBusyChange={setItemBusy}
              onRejected={onItemRejected}
            />
          ))}
        </ul>
      )}

      {/* 상한에 걸렸다 — 처리하면 다음 것이 올라온다(다음 장을 넘기는 UI 대신 이 흐름을 쓴다,
          service.INBOX_LIMIT 주석). 개수는 목록과 전체 수의 차이로 구한다. */}
      {items !== null && pending > items.length && (
        <p className="composer__hint" data-od-id="inbox-more">
          아직 {pending - items.length}건이 더 있습니다 — 여기 있는 것을 처리하면 다음 것이
          올라옵니다.
        </p>
      )}

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}

      <div className="composer__actions">
        <button
          className="btn btn--secondary composer__btn"
          type="button"
          data-od-id="inbox-close"
          disabled={anyRejecting}
          onClick={() => setClosing(true)}
        >
          닫기
        </button>
      </div>
    </GameDialog>
  );
}

/* 제안 한 줄. 대상이 보드에 없으면(그 사이 삭제됐다) 반영을 막는다 — 폼을 열 게임이 없어서다.
   거절은 그때도 열어 둔다: 반영할 수 없게 된 제안이야말로 정리할 대상이다.

   거절 액터를 **여기서** 만든다(부모가 아니라) — 항목마다 독립이어야 한 줄의 거절이 다른 줄의
   거절을 막지 않는다(rejectMachine 선언부 주석). busy·완료는 부모에게 보고하고(onBusyChange·
   onRejected), 실패 문구는 이 줄 안에 그대로 그린다 — 어느 줄이 실패했는지 화면에서 바로
   드러난다(공유 배너 하나로 몰던 원본보다 실패 귀속이 오히려 더 분명해진다). */
function InboxItem({
  item,
  game,
  wasCapped,
  onApply,
  onBusyChange,
  onRejected,
}: {
  item: SuggestionListItem;
  game: GameCard | null;
  wasCapped: boolean;
  onApply: () => void;
  onBusyChange: (id: number, busy: boolean) => void;
  onRejected: (result: { id: number; resolved: boolean; wasCapped: boolean }) => void;
}) {
  const [rejectState, sendReject] = useMachine(rejectMachine, {
    input: {
      run: (values, signal) =>
        trpc.suggestions.resolve
          .mutate({ id: values.id, resolution: "rejected" }, { signal })
          .then(({ resolved }) => ({ id: values.id, resolved, wasCapped: values.wasCapped })),
      mapError: resolveErrorMessage,
    },
  });
  const busy = rejectState.matches("submitting");
  const doneResult = rejectState.matches("done") ? rejectState.context.result : undefined;

  // busy 변화를 부모에 보고한다 — 언마운트(목록에서 빠짐·인박스 닫힘)될 땐 반드시 놓는다.
  useEffect(() => {
    onBusyChange(item.id, busy);
    return () => onBusyChange(item.id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, item.id]);

  // 성공을 부모에 인계한다(목록에서 빼기·배지 갱신은 부모 소관 — onItemRejected 주석).
  useEffect(() => {
    if (!doneResult) return;
    // 다른 effect 와 같은 이유로 async IIFE 안에서 한다(set-state-in-effect, Next 16 error).
    void (async () => {
      onRejected(doneResult);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneResult]);

  function onReject() {
    /* busy 를 effect(위)가 알리는 것만 기다리면 클릭과 부모의 anyRejecting 반영 사이에 창이
       생긴다 — 그 사이 「닫기」·Esc·배경을 누르면 모달의 close 가드가 아직 false 인 anyRejecting
       을 읽어 그대로 닫히고, 막 보낸 거절의 액터가 인계 전에 사라진다(review 가 잡은 자리).
       원본의 setRejectingId(item.id)가 클릭 핸들러 맨 앞에서 동기로 불렸던 것과 같은 이유로
       여기서도 동기로 먼저 알린다 — effect 의 보고는 그대로 두되(false 로 되돌리는 쪽은
       effect 가 맡는다), 같은 값을 두 번 보고해도 setBusyIds 의 동일값 무시가 멱등하게 흡수한다. */
    onBusyChange(item.id, true);
    sendReject({ type: "submit", values: { id: item.id, wasCapped } });
  }
  const changes =
    item.kind === "edit" && game
      ? diffSuggestion(
          { cleared: game.cleared, clearedDate: game.clearedDate, lastPlayed: game.lastPlayed },
          item.proposed,
        )
      : [];
  const missing = item.kind === "edit" && !game;

  return (
    <li className="inbox__item" data-od-id={"suggestion-" + item.id}>
      <div className="inbox__head">
        <span className="inbox__target">
          {item.kind === "add" ? item.proposedTitle : (game?.categoryValue ?? "삭제된 게임")}
        </span>
        {/* 값 칸이 아니라 출처 표시라 표기형이 자연스럽다. 표시명이 없으면(치지직 계정 스냅샷이
            비었으면) 이름을 지어내지 않는다 — 누가 보냈는지 모른다는 게 사실이다. */}
        <span className="inbox__meta">
          {item.authorName ?? "이름 없음"} · {formatDate(dateOfInstantKST(item.createdAt))}
        </span>
      </div>

      {item.kind === "add" && (
        <p className="inbox__kind" data-od-id={"suggestion-kind-" + item.id}>
          보드에 없는 게임 추가 요청
        </p>
      )}

      {missing && <p className="inbox__kind">이 게임은 보드에서 사라졌습니다.</p>}

      {/* 바뀌는 것만 그린다 — 안 바뀌는 줄까지 세우면 무엇을 봐야 하는지가 화면에서 사라진다
          (core.diffSuggestion). 추가 요청은 견줄 현재 값이 없어 제안 값을 그대로 나열한다. */}
      {changes.length > 0 && (
        <dl className="inbox__diff" data-od-id={"suggestion-diff-" + item.id}>
          {changes.map((c) => (
            <div className="inbox__change" key={c.field}>
              <dt>{FIELD_LABEL[c.field]}</dt>
              <dd>
                <span className="inbox__from">{sideText(c, "from")}</span>
                <span className="inbox__arrow" aria-hidden="true">
                  →
                </span>
                <span className="inbox__to">{sideText(c, "to")}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {item.kind === "add" && (
        <dl className="inbox__diff">
          <div className="inbox__change">
            <dt>플레이한 날</dt>
            <dd>{dateText(item.proposed.playedDate)}</dd>
          </div>
          <div className="inbox__change">
            <dt>클리어</dt>
            <dd>{item.proposed.cleared ? "완료" : "미완료"}</dd>
          </div>
        </dl>
      )}

      {/* 값이 하나도 안 바뀌는 수정 제안이 정상이다 — 한마디만 있는 제보가 그렇다. 그때 이 줄이
          유일한 내용이므로 "바뀔 값이 없다"를 따로 말해 줘야 관리자가 빈 줄로 오해하지 않는다. */}
      {item.kind === "edit" && !missing && changes.length === 0 && (
        <p className="inbox__kind">바꿀 값은 없고 한마디만 왔습니다.</p>
      )}

      {item.note && <p className="inbox__note">{item.note}</p>}

      {rejectState.context.error && (
        <p className="err" role="alert">
          {rejectState.context.error}
        </p>
      )}

      <div className="inbox__acts">
        <button
          className="btn btn--primary composer__btn"
          type="button"
          data-od-id={"suggestion-apply-" + item.id}
          disabled={busy || missing}
          onClick={onApply}
        >
          반영하기
        </button>
        <button
          className="btn btn--secondary composer__btn"
          type="button"
          data-od-id={"suggestion-reject-" + item.id}
          disabled={busy}
          onClick={onReject}
        >
          {busy ? "거절 중…" : "거절"}
        </button>
      </div>
    </li>
  );
}

// 필드 이름. 폼의 라벨과 같은 말을 써야 관리자가 두 화면을 이어 읽는다.
const FIELD_LABEL: Record<SuggestionChange["field"], string> = {
  cleared: "클리어",
  clearedDate: "클리어한 날",
  playedDate: "플레이한 날",
};

// 값 칸이라 표기형이다(GameFacts 와 같은 어휘). "없음"은 비어 있음을 적는 표기지 서술이 아니다.
function dateText(v: string | null): string {
  return v ? formatDate(v) : "없음";
}

function sideText(c: SuggestionChange, side: "from" | "to"): string {
  const v = c[side];
  return typeof v === "boolean" ? (v ? "완료" : "미완료") : dateText(v);
}
