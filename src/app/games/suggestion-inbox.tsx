"use client";

import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useState } from "react";
import { dateOfInstantKST } from "@/core/calendar";
import { readErrorMessage, REQUEST_TIMEOUT_MS, resolveErrorMessage } from "@/core/error-message";
import { formatDate } from "@/core/games";
import { diffSuggestion, type SuggestionChange } from "@/core/suggestions";
import { createSubmitMachine } from "@/core/submit.machine";
import type { GameCard } from "@/features/games/service";
import { INBOX_LIMIT, type SuggestionListItem } from "@/features/suggestions/service";
import { trpc } from "@/features/trpc/client";
import { GameDialog } from "./game-dialog";

/* 제안함은 열려 있는 동안 항목마다 여러 번 거절을 보낸다 — 이 머신 인스턴스 하나를
   재사용한다(submit.machine.ts 의 "done 은 final 이 아니다" 참고). values 에 wasCapped 를 함께
   싣는 이유는 stale-run 규칙 때문이다: run 은 마운트 시점에 얼어붙어 그때의 items.length 를
   못 읽으므로, 클릭 시점에 계산한 값을 실어 보낸다(game-editor 의 dateApplied 와 같은 패턴). */
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

   대상 게임의 현재 값은 **보드가 이미 든 목록에서 찾는다**(games prop). 서버가 조인해 실어
   보내지 않는 이유는 그래야 제안함이 그리는 "현재 값"이 바로 뒤 보드가 그리는 값과 확실히
   같아지기 때문이다. */
export function SuggestionInbox({
  games,
  pending,
  onApply,
  onResolved,
  onClose,
}: {
  games: GameCard[];
  /* 미처리 제안 **전체** 수(배지가 쓰는 그 값). 목록은 상한이 있어(INBOX_LIMIT) 이 수보다
     짧을 수 있는데, 그 사실을 화면이 말하지 않으면 관리자가 "제안은 이게 전부"로 오해한다. */
  pending: number;
  // 「반영하기」 — 부모가 제안함을 닫고 제안 값을 채운 폼을 연다.
  onApply: (item: SuggestionListItem) => void;
  // 거절로 목록이 줄었다 — 부모의 배지 수를 맞춘다.
  onResolved: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<SuggestionListItem[] | null>(null);
  // 목록 최초 로드 실패. 거절 자체의 실패·타임아웃은 rejectState.context.error 가 맡는다.
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [rejectState, sendReject] = useMachine(rejectMachine, {
    input: {
      run: (values, signal) =>
        trpc.suggestions.resolve
          .mutate({ id: values.id, resolution: "rejected" }, { signal })
          .then(({ resolved }) => ({ id: values.id, resolved, wasCapped: values.wasCapped })),
      mapError: resolveErrorMessage,
    },
  });
  const rejecting = rejectState.matches("submitting");
  // 지금 거절 중인 줄 — 버튼 하나만 잠그려면 id 가 필요하다(전체를 잠그면 다른 줄도 못 읽는다).
  // submitting 진입 전엔 values 가 없을 수 있어(idle/done) rejecting 으로 먼저 가드한다.
  const rejectingId = rejecting ? (rejectState.context.values?.id ?? null) : null;
  // 넘친 큐를 이어 받다 실패했을 때만 쓰는 문구 — 거절 자체는 성공했으므로 rejectState.context.error
  // 를 그대로 쓰면 "거절 실패"로 거짓말이 된다(원본 코드의 별도 catch와 같은 이유).
  const [refetchError, setRefetchError] = useState("");

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

  /* 거절 성공의 후처리(목록에서 빼기·배지 갱신·넘친 큐 이어 받기) — run 이 아니라 여기서 한다.
     run 은 마운트 시점에 얼어붙어 onResolved 같은 최신 콜백을 못 붙잡지만(stale-run 규칙),
     이 effect 는 렌더마다 새로 도니 늘 최신을 본다.

     의존성은 **doneResult 하나뿐이다.** onResolved 는 game-board.tsx 가 인라인 함수로 넘겨
     렌더마다 참조가 바뀐다 — 실으면 doneResult 가 그대로인(옛 성공을 아직 안 지운) 채로 부모가
     아무 이유로나 리렌더될 때마다 배지를 또 줄인다. fetchPending 은 useCallback([]) 이라
     안전하지만 같은 이유로 굳이 싣지 않는다(games-composer 의 debounce effect와 같은 판단). */
  const doneResult = rejectState.matches("done") ? rejectState.context.result : undefined;
  useEffect(() => {
    if (!doneResult) return;
    // 다른 effect(목록 최초 로드)와 같은 이유로 async IIFE 안에서 한다 — effect 본문 최상위의
    // 동기 setState 는 set-state-in-effect(Next 16 error)에 걸린다.
    void (async () => {
      const { id, resolved, wasCapped } = doneResult;
      // 목록에서는 어느 쪽이든 뺀다 — 이미 처리된 줄도 여기 남을 이유가 없다.
      setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
      /* **배지는 우리가 실제로 처리했을 때만 줄인다.** 서버는 미처리인 것만 고치므로(CAS)
         다른 관리자가 먼저 처리했으면 false 가 오는데, 그때도 줄이면 이미 남이 줄인 수에서
         한 번 더 빠져 배지가 실제 미처리 수보다 작아진다. */
      if (resolved) onResolved();
      // 넘친 큐를 여기서 이어 받는다. 안 넘쳤으면 왕복을 아낀다(대부분의 실사용이 그쪽이다).
      // 이 읽기가 실패해도 거절은 이미 성공했다 — rejectState.context.error 로 말하면 거짓이
      // 되므로 별도 문구를 쓴다(화면은 한 줄 줄어든 채 남고, 다시 열면 채워진다).
      if (wasCapped) {
        try {
          setItems(await fetchPending());
        } catch {
          setRefetchError("다음 제안을 불러오지 못했습니다 — 닫았다 열면 이어서 보입니다.");
        }
      }
    })();
    /* onResolved 는 game-board.tsx 가 인라인 함수로 넘겨 렌더마다 참조가 바뀐다 — 실으면
       doneResult 가 그대로인(옛 성공을 아직 안 지운) 채로 부모가 아무 이유로나 리렌더될 때마다
       배지를 또 줄인다. fetchPending 은 useCallback([]) 이라 안전하지만 같은 이유로 굳이 싣지
       않는다(games-composer 의 debounce effect와 같은 판단). */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneResult]);

  function onReject(item: SuggestionListItem) {
    setRefetchError("");
    /* 지금 화면이 **상한에 걸려 있었나**(처리 전 기준). 걸려 있었다면 한 줄을 비운 자리에
       다음 제안이 올라와야 한다 — 안 그러면 화면이 "처리하면 다음 것이 올라와요"라고 적어
       놓고 실제로는 안 올리는 거짓말이 되고, 큐가 넘친 상황에서 관리자는 닫았다 여는 조작을
       반복해야 한다(적대적 리뷰 5라운드 — 상한을 넣은 4라운드 수정이 만든 자리다). */
    const wasCapped = (items?.length ?? 0) >= INBOX_LIMIT;
    sendReject({ type: "submit", values: { id: item.id, wasCapped } });
  }

  return (
    <GameDialog
      title="들어온 제안"
      odId="suggestion-inbox"
      className="composer--detail"
      closing={closing}
      busy={rejecting}
      // 본문에 「닫기」가 있으므로 모서리 X 를 끈다 — 같은 일을 하는 손잡이 둘이 한 화면에
      // 있으면 사용자가 차이를 찾느라 멈춘다(GameDialog 의 closeButton 규약).
      closeButton={false}
      onClose={onClose}
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
              busy={rejectingId === item.id}
              /* 닫기는 **부모가 한다** — 여기서 closing 신호를 세우면 부모가 같은 tick 에
                 언마운트하는 것과 겹쳐 close 이벤트가 안 온다. 겹쳐 띄우지 않는 이유는 따로
                 있다: 반영 폼이 그 자체로 취소·미저장 확인을 쥐고 있어 세 겹(제안함 → 폼 →
                 미저장 확인)이 되는데, ADR-0023 이 "여기서 더 깊어지면 구조를 다시 본다"고
                 그은 선이 정확히 세 겹이다. */
              onApply={() => onApply(item)}
              onReject={() => onReject(item)}
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

      {(error || rejectState.context.error || refetchError) && (
        <p className="err" role="alert">
          {error || rejectState.context.error || refetchError}
        </p>
      )}

      <div className="composer__actions">
        <button
          className="btn btn--secondary composer__btn"
          type="button"
          data-od-id="inbox-close"
          disabled={rejecting}
          onClick={() => setClosing(true)}
        >
          닫기
        </button>
      </div>
    </GameDialog>
  );
}

/* 제안 한 줄. 대상이 보드에 없으면(그 사이 삭제됐다) 반영을 막는다 — 폼을 열 게임이 없어서다.
   거절은 그때도 열어 둔다: 반영할 수 없게 된 제안이야말로 정리할 대상이다. */
function InboxItem({
  item,
  game,
  busy,
  onApply,
  onReject,
}: {
  item: SuggestionListItem;
  game: GameCard | null;
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
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
