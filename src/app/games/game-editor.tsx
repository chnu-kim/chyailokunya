"use client";

import { useMachine } from "@xstate/react";
import { useEffect, useState } from "react";
import { REQUEST_TIMEOUT_MS, updateErrorMessage } from "@/core/error-message";
import { isPlayDateEditable } from "@/core/games";
import { initialPlayDateFor, isPlayDateApplied } from "@/core/suggestions";
import { createSubmitMachine } from "@/core/submit.machine";
import type { GameCard } from "@/features/games/service";
import { trpc } from "@/features/trpc/client";
import { GameDialog } from "./game-dialog";
import { ClearedFields, PlayedDateField, useClearedDraft } from "./game-fields";

/* dateApplied 는 **run 이 계산하지 않는다**(submit.machine.ts 의 stale-run 규칙). run 은
   마운트 시점에 얼어붙는데, dateApplied 가 읽는 locked 는 비동기로 조회되는 dates 에 의존해
   마운트 순간엔 늘 dates===null → locked===false 로 계산된다 — ADR-0025 의 "클리어만 반영됐는데
   제안은 처리됨으로 사라진다" 가드가 조용히 깨진다. 그래서 dateApplied 는 렌더마다 새로 만들어지는
   onSave 안에서 최신 locked 로 계산해 submit 이벤트의 values 에 실어 보내고, run 은 그 값을
   그대로 통과시키기만 한다. */
const editMachine = createSubmitMachine<
  { payload: Parameters<typeof trpc.games.update.mutate>[0]; dateApplied: boolean },
  { row: GameCard; dateApplied: boolean }
>();

/* 게임 수정 모달. 고치는 건 클리어 상태와 플레이 날짜 둘이다 — 제목·포스터는 "무엇을 고치는지"
   확인용으로만 싣는다(게임 자체를 바꾸려면 떼고 다시 붙인다 — categoryId 가 정본 키라 갈아끼우면
   중복 방지가 무너진다). 서버 updateGameInput 은 부분 패치가 아니라 셋을 늘 함께 받는다.

   플레이 날짜는 games 컬럼이 아니라 일정 항목을 고친다(정본은 schedule_entries, 이슈 #56 결정 3).
   그래서 **열자마자 그 게임의 일정 날짜를 조회한다** — 상세(GameCard.lastPlayed)에 있는 값을 못
   쓰는 이유가 둘이다: (1) lastPlayed 는 발행된 항목만 세므로 초안 주의 항목이 안 보여 "0개"로
   오해하고, (2) 여러 날 편성인지 알 수 없어 잠금 판단이 안 선다. 조회는 game:write 를 요구한다
   (초안 유출 방지 — router.playDates).

   조회 실패는 저장을 막는다. 날짜를 모르는 채로 저장하면 빈 입력이 그대로 나가 멀쩡한 일정
   항목이 지워진다(playedDate=null 은 삭제다) — 그 자리는 조용해서 특히 위험하다. */
export function GameEditor({
  game,
  stacked,
  initial,
  onUpdated,
  onClose,
}: {
  game: GameCard;
  // 카드 상세 위에 겹쳐 떴는가 — 그렇다면 스크림을 한 겹 더 깔지 않는다.
  stacked: boolean;
  /* 팬 제안을 **반영**하려고 열었을 때의 출발점(ADR-0025). 값을 미리 채워 두면 관리자가
     제안함에서 본 값을 손으로 옮겨 적지 않아도 되고, 저장은 평소의 update 경로를 그대로 탄다 —
     승인 전용 쓰기를 안 만드는 게 이 설계의 핵심이라(결정 2) 여기서 갈라지면 안 된다. */
  initial?: { cleared: boolean; clearedDate: string; playedDate: string };
  /* dateApplied = 이번 저장이 **요청된 플레이 날짜까지** 담았나. 제안을 반영하는 부모가 이걸
     알아야 "클리어만 반영됐는데 제안은 처리됨으로 사라지는" 자리를 막는다(core.isPlayDateApplied). */
  onUpdated: (row: GameCard, meta: { dateApplied: boolean }) => void;
  onClose: () => void;
}) {
  const { draft, setDraft } = useClearedDraft({
    cleared: initial?.cleared ?? game.cleared,
    clearedDate: initial?.clearedDate ?? game.clearedDate ?? "",
  });
  /* 이 게임의 일정 날짜. null = 아직 불러오는 중(그동안 날짜 입력은 잠긴다 — PlayedDateField
     주석의 "빈 칸을 날짜 없음으로 오해해 지우는" 자리). */
  const [dates, setDates] = useState<string[] | null>(null);
  const [playedDate, setPlayedDate] = useState("");
  /* 열릴 때 읽은 날짜. 두 곳에 쓴다: (1) 사용자가 실제로 고쳤는지 판별해 안 고쳤으면 저장에
     안 싣고, (2) 실을 땐 precondition 으로 함께 보내 그 사이 딴 데서 바뀌었으면 서버가
     CONFLICT 를 낸다(schema.playedDateWas). */
  const [loadedDate, setLoadedDate] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // 닫기 신호. 컴포저와 같은 이유로 성공 즉시 onUpdated 를 부르지 않는다 — 부모가 같은 커밋에서
  // 언마운트하면 dialog 가 열린 채 빠져 포커스가 body 로 떨어진다.
  const [manualClosing, setManualClosing] = useState(false);
  const [state, send] = useMachine(editMachine, {
    input: {
      run: (values, signal) =>
        trpc.games.update.mutate(values.payload, { signal }).then((row) => ({
          row,
          dateApplied: values.dateApplied,
        })),
      // 수정 전용 문구다 — 이 경로의 CONFLICT 는 중복 게임이 아니라 낡은 플레이 날짜다.
      mapError: updateErrorMessage,
    },
  });
  const saving = state.matches("submitting");
  const saved = state.matches("done") ? state.context.result : null;

  /* 제안이 채우는 날짜. 객체가 아니라 원시값을 뽑아 두는 건 아래 effect 의존성에 싣기 위해서다 —
     initial 객체는 매 렌더 새로 만들어지므로 그대로 실으면 조회가 무한히 다시 돈다. */
  const initialPlayedDate = initial?.playedDate;
  /* **팬이 본 값**(보드의 lastPlayed). 두 자리가 이걸 기준으로 삼는다: 제안 값을 입력에 실을지
     (initialPlayDateFor)와 반영이 날짜까지 담았는지(isPlayDateApplied). 폼의 loadedDate 를 쓰면
     안 되는 이유가 각각 다르다 — 앞은 팬이 못 본 초안 항목을 지우게 되고, 뒤는 여러 날 편성일 때
     loadedDate 가 빈 값이라 정상 반영까지 미완으로 떨어진다. */
  const shownDate = game.lastPlayed ?? "";

  /* 열릴 때 한 번 조회한다. setState 가 await 뒤에서만 일어나므로 effect 안 **동기** setState 를
     막는 규칙(set-state-in-effect)에 걸리지 않는다. 모달은 editing 이 null 을 거쳐 매번 리마운트
     되므로 게임이 바뀌면 이 effect 도 다시 돈다 — 의존성에 game.id 를 두는 건 그 사실의 표시다. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const found = await trpc.games.playDates.query(
          { id: game.id },
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        if (!alive) return;
        setDates(found);
        // 항목이 하나면 그 날짜가 곧 편집 대상이다. 여럿이면 잠기고 저장에 안 실린다(onSave).
        const loaded = found.length === 1 ? found[0]! : "";
        /* **precondition 은 언제나 서버가 준 값이다** — 제안 값으로 덮으면 낙관적 동시성이
           통째로 무력화된다(서버는 "폼이 열릴 때 본 날짜"로 알고 대조하는데, 실제로는 팬이
           며칠 전에 적어 낸 값이라 그 사이의 일정 변경을 조용히 되돌린다). 제안이 채우는 건
           **입력값**뿐이고, 그래서 그 값이 지금 값과 다르면 정상적으로 dateEdited 가 선다. */
        setLoadedDate(loaded);
        /* 팬이 **실제로 고친** 날짜만 싣는다 — 제안 스냅샷을 그대로 넣으면 초안 주의 항목처럼
           팬이 못 본 날짜를 지우라는 지시가 된다(core.initialPlayDateFor). */
        setPlayedDate(initialPlayDateFor(initialPlayedDate, shownDate, loaded));
      } catch {
        if (!alive) return;
        setLoadFailed(true);
      }
    })();
    // 응답이 늦게 와도 언마운트 뒤엔 상태를 안 건드린다.
    return () => {
      alive = false;
    };
    /* shownDate 도 싣는다 — 프리필 판정이 이걸 읽으므로 빠지면 낡은 값으로 채운다. game 이 바뀌면
       game.id 와 함께 바뀌므로 실질적으로 재조회를 늘리지 않는다(모달은 매번 리마운트된다). */
  }, [game.id, initialPlayedDate, shownDate]);

  /* 여러 날 편성이면 입력이 잠기고(core.isPlayDateEditable) 저장에 날짜를 안 싣는다.
     dateEdited 는 조회가 끝난 뒤에만 참이 될 수 있다 — dates 가 null 인 동안 playedDate 는
     아직 빈 채라, 그 차이를 "고쳤다"로 세면 열자마자 낡은 빈 값이 저장에 실린다. */
  const locked = dates !== null && !isPlayDateEditable(dates);
  const dateEdited = !locked && dates !== null && playedDate !== loadedDate;

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    /* playedDate 를 **싣지 않는 경우가 둘**이고, 둘 다 "일정을 안 건드린다"는 뜻이다
       (서버 playDateInput 규약 — 필드 부재).

       1. 여러 날 편성이라 입력이 잠겼다. 한때 잠금 상태에서 빈 문자열을 실었는데 그게
          null 로 접혀 "여러 날을 지우려 한다"로 거절돼 **저장이 통째로 막혔다**.
       2. 사용자가 날짜 칸을 **안 건드렸다.** 안 실어야 하는 이유가 둘이다: 같은 값을
          되보내면 주 revision 이 올라 열어 둔 편집기가 원인 없는 CONFLICT 를 받고, 더
          나쁘게는 폼이 열린 뒤 딴 데서 그 항목이 옮겨졌을 때 **stale 한 값이 남의 일정
          작업을 되돌려 놓는다**(적대적 리뷰 5·6라운드 — 서버도 precondition 으로 막는다).

       날짜를 실제로 고쳤으면 playedDateWas 를 함께 보낸다 — 열었을 때의 값이라 서버가
       그 사이 바뀌었는지 판정할 수 있다.
       빈 문자열 → null 전처리의 정본은 서버 updateGameInput(Zod)이다 — 여기서 다시 하지 않는다.

       dateApplied 도 여기서(렌더마다 새로 만들어지는 이 함수 안에서) 최신 locked 로 계산해
       함께 보낸다 — run 은 이 값을 받아 그대로 통과시키기만 한다(위 stale-run 주석). 기준은
       **보드가 그리는 날짜**(shownDate)다. loadedDate 로 재면 여러 날 편성일 때 그 값이 빈
       문자열이라, 클리어만 고치는 정상 반영까지 "날짜를 못 실었다"로 떨어진다. */
    send({
      type: "submit",
      values: {
        payload: {
          id: game.id,
          cleared: draft.cleared,
          clearedDate: draft.clearedDate,
          ...(dateEdited ? { playedDate, playedDateWas: loadedDate } : {}),
        },
        dateApplied: isPlayDateApplied(initial?.playedDate ?? shownDate, shownDate, locked),
      },
    });
  }

  /* 저장 안 한 수정이 있는가 — 배경 클릭·Esc 로 닫을 때 되묻는 기준이다(GameDialog 의 dirty).
     날짜 쪽은 dateEdited 를 그대로 쓴다: 불러오는 중의 빈 입력을 고침으로 세면 열자마자
     닫기가 막힌다(위 주석). */
  const dirty =
    dateEdited || draft.cleared !== game.cleared || draft.clearedDate !== (game.clearedDate ?? "");

  return (
    <GameDialog
      /* "클리어 수정"이었다 — 플레이 날짜가 돌아오며 고치는 게 둘이 됐다. 제목이 필드보다 좁으면
         사용자는 날짜를 고치러 여기 들어올 생각을 못 한다. */
      title="게임 수정"
      odId="game-editor"
      className={stacked ? "composer--stacked" : undefined}
      closing={manualClosing || saved !== null}
      busy={saving}
      dirty={dirty}
      // 삭제 확인과 같은 이유로 X 를 끈다 — 본문에 "취소"가 있다(GameDialog 의 closeButton).
      closeButton={false}
      onClose={() => (saved ? onUpdated(saved.row, { dateApplied: saved.dateApplied }) : onClose())}
    >
      <form className="composer__detail" onSubmit={onSave}>
        {/* 첫 필드가 플레이 날짜라 안내도 그 순서로 말한다 — 클리어만 언급하면 바로 아래
            날짜 입력이 무엇인지 설명 없이 서 있다. */}
        <p className="composer__hint">플레이한 날과 클리어 여부를 고칠 수 있습니다.</p>

        <div className="composer__chosen" data-od-id="game-editor-game">
          {game.posterImageUrl ? (
            <img
              className="composer__poster composer__poster--lg"
              src={game.posterImageUrl}
              alt=""
              width={72}
              height={96}
            />
          ) : (
            <span className="composer__noposter composer__poster--lg" aria-hidden="true">
              {game.categoryValue.charAt(0)}
            </span>
          )}
          <span className="composer__chosenname">{game.categoryValue}</span>
        </div>

        <PlayedDateField
          value={playedDate}
          onChange={setPlayedDate}
          idPrefix="editor"
          dates={dates}
          disabled={saving}
        />

        <ClearedFields
          draft={draft}
          onChange={setDraft}
          idPrefix="editor-clear"
          disabled={saving}
        />

        {loadFailed && (
          <p className="err" role="alert">
            일정을 못 불러와서 저장할 수 없습니다. 닫았다 다시 열어 주십시오.
          </p>
        )}

        {state.context.error && (
          <p className="err" role="alert">
            {state.context.error}
          </p>
        )}

        <div className="composer__actions">
          <button
            className="btn btn--secondary composer__btn"
            type="button"
            data-od-id="game-editor-cancel"
            // 저장이 날아가는 동안은 취소도 막는다 — 닫기와 같은 인계 경쟁이다(GameDialog 주석).
            disabled={saving}
            onClick={() => setManualClosing(true)}
          >
            취소
          </button>
          <button
            className="btn btn--primary composer__btn"
            type="submit"
            /* 날짜를 못(아직) 불러왔으면 저장을 막는다 — 빈 입력이 그대로 나가면 멀쩡한 일정
               항목이 지워진다(playedDate=null 은 삭제다). */
            disabled={saving || dates === null}
            data-od-id="game-editor-submit"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </form>
    </GameDialog>
  );
}
