"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { ANGLE, axis, coerce, PATTERNS, ROT, statusOf, type Game, type Status } from "@/core/games";
import {
  commitGames,
  getGamesServerSnapshot,
  getGamesSnapshot,
  subscribeGames,
} from "./games-store";

type Filter = "all" | Status;
type Pending = { game: Game; index: number };

const FILTERS: { value: Filter; label: string; odId: string }[] = [
  { value: "all", label: "전체", odId: "filter-all" },
  { value: "playing", label: "플레이중", odId: "filter-playing" },
  { value: "cleared", label: "클리어", odId: "filter-cleared" },
  { value: "played", label: "플레이함", odId: "filter-played" },
  { value: "planned", label: "예정", odId: "filter-planned" },
];

// --rest-rot/--thumb-a 같은 CSS 커스텀 속성을 인라인 style 로 넘길 때의 타입 우회.
function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "g-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

/* 유령이 들어설 자리를 현재 필터 기준으로 다시 센다. pending.index 는 삭제 직전 위치인데,
   그 앞쪽 원소들은 삭제 후에도 그대로라 그중 필터를 통과하는 개수가 곧 화면상의 위치다.
   필터가 유령 자신을 걸러내면 보여줄 자리가 없다(-1). */
function ghostIndex(games: Game[], pending: Pending, filter: Filter): number {
  if (filter !== "all" && pending.game.status !== filter) return -1;
  let n = 0;
  for (let i = 0; i < pending.index && i < games.length; i++) {
    const g = games[i];
    if (g && (filter === "all" || g.status === filter)) n++;
  }
  return n;
}

export function GameBoard() {
  // 목록·저장가능 여부는 localStorage 를 감싼 외부 스토어에서 읽는다 — SSR·수화 땐 시드,
  // 마운트 후 실제 저장 목록으로 다시 그린다(수화 불일치 없음). 변경은 commitGames 로만.
  const { games, storageOK } = useSyncExternalStore(
    subscribeGames,
    getGamesSnapshot,
    getGamesServerSnapshot,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState<Pending | null>(null);
  // "방금 생긴 유령"만 가라앉는다 — 필터를 눌러도 다시 가라앉지 않게, 삭제 시 그 id 만 켠다.
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [addStatus, setAddStatus] = useState("");
  const [nameError, setNameError] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const genreRef = useRef<HTMLInputElement>(null);
  const platformRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);

  const pendingRef = useRef<Pending | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 렌더 후 옮길 포커스 — 유령 되돌리기 버튼 또는 그리드. 레이아웃 effect 가 소비한다.
  const pendingFocus = useRef<"ghost" | "grid" | null>(null);
  const downOutside = useRef(false);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // 컴포넌트가 사라질 때 남은 타이머 정리.
  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  function ghostBtn(): HTMLButtonElement | null {
    return gridRef.current?.querySelector<HTMLButtonElement>(".game__undo") ?? null;
  }
  function focusGrid() {
    // preventScroll 필수: 보드는 화면 하나를 차지하는 컨테이너라, 그냥 focus 하면 브라우저가
    // 보드 top 을 뷰포트로 끌어온다(페이지 위에서 삭제·되돌리면 화면이 저 혼자 내려갔다).
    gridRef.current?.focus({ preventScroll: true });
  }

  function clearUndoTimer() {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  }

  function forgetUndo() {
    clearUndoTimer();
    if (!pendingRef.current) return;
    // 되돌리기 버튼에 포커스가 남은 채 지우면 포커스가 <body> 로 떨어진다.
    const hadFocus = document.activeElement === ghostBtn();
    setPending(null);
    setSettlingId(null);
    if (hadFocus) pendingFocus.current = "grid";
  }

  function armUndoTimer() {
    clearUndoTimer();
    // 자동 해제는 사용자가 이 버튼을 보고 있지 않을 때만. hasFocus() 도 필요하다: 창이
    // 백그라운드로 가도 activeElement 는 버튼에 남으므로, 창을 떠난 사람은 고민 중이 아니다.
    const tick = () => {
      if (document.hasFocus() && document.activeElement === ghostBtn()) {
        undoTimer.current = setTimeout(tick, 8000);
        return;
      }
      forgetUndo();
    };
    undoTimer.current = setTimeout(tick, 8000);
  }

  function onDelete(id: string) {
    const at = games.findIndex((g) => g.id === id);
    if (at < 0) return;
    const removed = games[at]!;
    const next = games.slice();
    next.splice(at, 1);
    commitGames(next);
    // 앞선 삭제가 아직 안 정해졌으면 그건 확정된다 — 유령은 한 번에 하나다.
    clearUndoTimer();
    setPending({ game: removed, index: at });
    setSettlingId(removed.id);
    // 누른 버튼이 방금 사라져 포커스가 <body> 로 떨어진다. 같은 자리에 들어선 유령의
    // 되돌리기로 넘긴다(레이아웃 effect 가 렌더 후 포커스 + 타이머 무장).
    pendingFocus.current = "ghost";
  }

  function doUndo() {
    const p = pendingRef.current;
    if (!p) return;
    const at = Math.min(p.index, games.length);
    const next = games.slice();
    next.splice(at, 0, p.game);
    commitGames(next);
    clearUndoTimer();
    setPending(null);
    setSettlingId(null);
    setAnnouncement("‘" + p.game.name + "’ 복구했어요.");
    pendingFocus.current = "grid";
  }

  function onFilter(f: Filter, label: string) {
    setFilter(f);
    // 어떤 상호작용이든 "방금"을 소비한다 — 유령이 다시 나타나도 안 가라앉게.
    setSettlingId(null);
    const shown = games.filter((g) => f === "all" || g.status === f).length;
    setAnnouncement(
      f === "all" ? "전체 " + games.length + "개 표시" : label + " " + shown + "개 표시",
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = nameRef.current?.value.trim() ?? "";
    if (!name) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    setNameError(false);
    // 붙이는 순간 앞선 삭제는 확정된다.
    clearUndoTimer();
    setPending(null);
    setSettlingId(null);

    const status = (statusRef.current?.value ?? "played") as Status;
    const g = coerce(
      {
        id: newId(),
        name,
        genre: genreRef.current?.value ?? "",
        platform: platformRef.current?.value ?? "",
        status,
      },
      0,
    );
    if (!g) return; // name 이 비지 않으므로 실제로는 null 이 아니다
    const next = [g, ...games];
    commitGames(next);

    formRef.current?.reset();
    // 같은 상태로 여러 개를 연달아 기록하는 게 보통이므로 방금 고른 값을 남긴다.
    if (statusRef.current) statusRef.current.value = status;
    // 방금 추가한 카드가 현재 필터에서 안 보이면 전체로 되돌린다.
    if (filter !== "all" && filter !== g.status) setFilter("all");
    setAnnouncement("‘" + g.name + "’ 추가했어요.");
    // 카드가 열린 동안 바깥은 inert 라 라이브 영역이 안 읽힌다 — 붙었다는 사실은 카드 안에서.
    setAddStatus("‘" + g.name + "’ 붙였어요. 총 " + next.length + "개.");
    nameRef.current?.focus();
  }

  function onNameInput() {
    if (nameRef.current?.value.trim()) setNameError(false);
  }

  // ---- 붙이기 카드 열기/닫기 — showModal 이 포커스 트랩·Esc·inert·백드롭·포커스 복원 담당 ----
  function openDialog() {
    dialogRef.current?.showModal();
  }
  function closeDialog() {
    dialogRef.current?.close();
  }

  /* 바깥 클릭으로 닫기 — showModal 은 안 준다. 백드롭 클릭은 dialog 자신을 target 으로 오는데,
     카드 안쪽 패딩 위를 눌러도 똑같이 dialog 가 target 이라 좌표를 사각형과 대조해 정말
     바깥인지 본다. 누른 곳과 뗀 곳을 둘 다 보는 이유: 입력을 드래그 선택하다 카드 밖에서
     떼면 click 이 dialog 로 올라와, 그때 닫으면 적던 게 사라진다. */
  function isBackdrop(e: React.PointerEvent | React.MouseEvent): boolean {
    const d = dialogRef.current;
    if (!d || e.target !== d) return false;
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }
  function onDialogPointerDown(e: React.PointerEvent) {
    downOutside.current = isBackdrop(e);
  }
  function onDialogClick(e: React.MouseEvent) {
    if (downOutside.current && isBackdrop(e)) closeDialog();
    downOutside.current = false;
  }
  // Esc·백드롭·닫기 버튼 어느 경로로 닫혀도 여기서 비운다.
  function onDialogClose() {
    formRef.current?.reset();
    setNameError(false);
    setAddStatus("");
  }

  // 렌더 후 포커스 이동을 소비한다(삭제 → 유령, 되돌리기 → 그리드).
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === "ghost") {
      const gb = ghostBtn();
      if (gb) gb.focus({ preventScroll: true });
      else focusGrid();
      armUndoTimer();
    } else if (target === "grid") {
      focusGrid();
    }
  });

  // ---- 렌더 목록 조립 ----
  const list = games.filter((g) => filter === "all" || g.status === filter);
  const gi = pending ? ghostIndex(games, pending, filter) : -1;

  const items: React.ReactNode[] = list.map((g) => {
    const st = statusOf(g.status);
    const rot = ROT[axis(g.id, "rot", ROT.length)] ?? ROT[0];
    const ang = ANGLE[axis(g.id, "ang", ANGLE.length)] ?? ANGLE[0];
    return (
      <div
        key={g.id}
        className="polaroid game"
        style={cssVars({ "--rest-rot": rot, "--thumb-a": ang })}
        data-od-id={"game-card-" + g.id}
      >
        <span className="clip" aria-hidden="true" />
        <div className="game__thumb" data-p={axis(g.id, "pat", PATTERNS)} aria-hidden="true">
          <span className="game__initial">{g.name.charAt(0)}</span>
          <svg>
            <use href="#mk-paw" />
          </svg>
        </div>
        <div className="game__body">
          <div className="game__top">
            <h3 className="game__name">{g.name}</h3>
            <span className={"chip " + st.cls}>{st.label}</span>
          </div>
          <dl className="game__meta">
            <div>
              <dt>장르</dt>
              <dd>{g.genre}</dd>
            </div>
            <div>
              <dt>플랫폼</dt>
              <dd>{g.platform}</dd>
            </div>
          </dl>
          <button
            className="game__del"
            type="button"
            aria-label={g.name + " 삭제"}
            onClick={() => onDelete(g.id)}
          >
            삭제
          </button>
        </div>
      </div>
    );
  });

  if (gi !== -1 && pending) {
    const settling = settlingId === pending.game.id;
    items.splice(
      gi,
      0,
      <div
        key={"ghost-" + pending.game.id}
        className={"polaroid game game--ghost" + (settling ? " game--settling" : "")}
        data-od-id="game-ghost"
      >
        <div className="game__thumb" aria-hidden="true" />
        <div className="game__body">
          <p className="game__ghost-msg">‘{pending.game.name}’ 뗐어요.</p>
          <button className="game__undo" type="button" onClick={doUndo} data-od-id="undo-restore">
            되돌리기
          </button>
        </div>
      </div>,
    );
  }

  const showEmpty = items.length === 0;
  const boardEmpty = games.length === 0;

  return (
    <>
      {/* HEAD */}
      <section className="head" data-od-id="play-log-head">
        <div className="wrap">
          <div className="head__row">
            <h1 data-od-id="play-log-title">플레이한 게임</h1>
            <span className="head__count">
              {filter === "all" ? (
                <>
                  총 <b>{games.length}</b>개
                </>
              ) : (
                <>
                  <b>{list.length}</b> / {games.length}개 표시
                </>
              )}
            </span>
          </div>
          <p className="head__lead">
            챠이로 쿠냐가 방송에서 플레이한 게임 보드입니다. 새 게임을 직접 붙이고, 상태로
            골라보세요. 추가한 목록은 이 브라우저에 저장돼요.
          </p>
        </div>
      </section>

      {/* BOARD */}
      <section className="board" aria-labelledby="board-h2">
        <div className="wrap">
          <h2 className="sr-only" id="board-h2">
            게임 목록
          </h2>

          <div
            className="filters"
            role="group"
            aria-label="상태로 거르기"
            data-od-id="status-filters"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                className="fchip"
                type="button"
                aria-pressed={filter === f.value}
                data-od-id={f.odId}
                onClick={() => onFilter(f.value, f.label)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <p className="storewarn" hidden={storageOK}>
            이 브라우저에는 목록을 저장할 수 없어요(시크릿 모드일 수 있어요). 새로고침하면
            사라집니다.
          </p>

          <div className="games" ref={gridRef} tabIndex={-1} data-od-id="game-grid">
            <button
              className="polaroid addslot"
              type="button"
              onClick={openDialog}
              data-od-id="add-open"
            >
              <span className="addslot__slot" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="addslot__label">새 게임 붙이기</span>
            </button>
            {items}
          </div>

          <div className="grid-empty" hidden={!showEmpty} data-od-id="game-grid-empty">
            <span className="t-hand">텅 비었네냥…</span>
            <span hidden={boardEmpty}>
              이 상태의 게임이 없어요. 다른 필터를 골라보거나 새 게임을 붙여보세요.
            </span>
            <span hidden={!boardEmpty}>
              아직 붙인 게임이 없어요. 빈 칸을 눌러 첫 게임을 붙여보세요.
            </span>
          </div>

          <p className="sr-only" role="status">
            {announcement}
          </p>

          {/* 네이티브 다이얼로그 — 포커스 트랩·Esc·뒤 배경 inert·백드롭·닫을 때 포커스 복원을
              전부 브라우저가 준다. autofocus 가 게임명에 있어 showModal 이 그걸 먼저 잡는다. */}
          <dialog
            className="paper composer"
            ref={dialogRef}
            aria-labelledby="composer-h2"
            data-od-id="game-composer"
            onPointerDown={onDialogPointerDown}
            onClick={onDialogClick}
            onClose={onDialogClose}
          >
            <span className="tape" aria-hidden="true">
              새 게임 ✎
            </span>
            <h2 className="sr-only" id="composer-h2">
              새 게임 붙이기
            </h2>
            <button
              className="composer__close"
              type="button"
              onClick={closeDialog}
              data-od-id="add-close"
              aria-label="닫기"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <form className="composer__body" ref={formRef} onSubmit={onSubmit} noValidate>
              <div className="composer__fields">
                <div className="fld fld--name">
                  <label htmlFor="f-name">
                    게임명{" "}
                    <span aria-hidden="true" className="req">
                      *
                    </span>
                  </label>
                  <input
                    className="field"
                    id="f-name"
                    name="name"
                    type="text"
                    placeholder="예: 스타듀 밸리"
                    autoComplete="off"
                    autoFocus
                    required
                    aria-describedby="f-name-err"
                    aria-invalid={nameError ? "true" : undefined}
                    ref={nameRef}
                    onInput={onNameInput}
                  />
                </div>
                <div className="fld">
                  <label htmlFor="f-genre">장르</label>
                  <input
                    className="field"
                    id="f-genre"
                    name="genre"
                    type="text"
                    placeholder="액션 RPG"
                    autoComplete="off"
                    ref={genreRef}
                  />
                </div>
                <div className="fld">
                  <label htmlFor="f-platform">플랫폼</label>
                  <input
                    className="field"
                    id="f-platform"
                    name="platform"
                    type="text"
                    placeholder="PC"
                    autoComplete="off"
                    ref={platformRef}
                  />
                </div>
                <div className="fld">
                  <label htmlFor="f-status">상태</label>
                  <select
                    className="select"
                    id="f-status"
                    name="status"
                    ref={statusRef}
                    defaultValue="played"
                  >
                    <option value="played">플레이함</option>
                    <option value="playing">플레이중</option>
                    <option value="cleared">클리어</option>
                    <option value="planned">예정</option>
                  </select>
                </div>
                <div className="composer__actions">
                  <button className="btn btn--primary" type="submit" data-od-id="submit-add-game">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    붙이기
                  </button>
                </div>
              </div>
              <p className="err" id="f-name-err" hidden={!nameError}>
                게임명을 적어주세요냥.
              </p>
              <p className="composer__added" role="status">
                {addStatus}
              </p>
              <p className="composer__hint">
                게임명만 적어도 돼요. 나머지는 비우면 “—”로 들어가요.
              </p>
            </form>
          </dialog>
        </div>
      </section>
    </>
  );
}
