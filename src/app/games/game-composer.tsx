"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ChzzkCategory } from "@/core/games";
import type { GameRow } from "@/db";
import { trpc } from "@/features/trpc/client";

/* 게임 추가 컴포저(ADR-0015·0017). 치지직 카테고리를 검색해(서버 인가된 tRPC, creds 는 서버에만)
   고른 뒤 games.add 뮤테이션으로 보드에 넣는다. 성공하면 onAdded 로 보드 상태를 낙관적 갱신한다.
   드물고 사적인 행동이라 상시 폭을 차지하지 않게 다이얼로그로 띄운다 — 여는 트리거는 보드 그리드
   첫 칸의 빈 폴라로이드(.addslot)다. 서버가 인가·중복(CONFLICT)을 정본으로 검사하므로 여기선
   결과를 한국어로 보여줄 뿐이다.

   네이티브 <dialog>+showModal() 을 쓰는 이유: 포커스 트랩·Esc 닫기·배경 inert·top-layer 를
   브라우저가 준다(직접 만든 백드롭 div 는 이걸 더 나쁘게 재구현한다). 진입 애니메이션·스크림·
   바텀시트는 games.css 의 dialog.composer 가 이미 그린다. 표면은 .paper — .polaroid 는
   --border-strong 을 안 되돌려 다크에서 입력 테두리가 1.01:1 로 사라진다(그 자리 주석 참고). */

/* tRPC 에러 **코드**로 분기한다 — 서버 문구 매칭(msg.includes("이미"))은 문구를 다듬는 순간
   조용히 죽는다. 세션 만료·권한 없음은 재시도로 안 풀리므로 실행 가능한 조치를 안내한다. */
function messageFor(e: unknown, fallback: string): string {
  const code = (e as { data?: { code?: string } } | null)?.data?.code;
  if (code === "CONFLICT") return "이미 보드에 있는 게임이에요.";
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN")
    return "로그인이 만료됐거나 권한이 없어요. 다시 로그인해 주세요.";
  return fallback;
}

export function GameComposer({
  onAdded,
  onClose,
}: {
  onAdded: (row: GameRow) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChzzkCategory[]>([]);
  const [error, setError] = useState("");
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  // 마운트되면 모달로 띄운다 — showModal() 이 top-layer·포커스 트랩·배경 inert 를 켠다.
  // 언마운트(부모가 composing=false)로 닫히므로 exit 애니메이션은 생략된다(진입만) — CSS 가
  // @starting-style 를 모르는 브라우저에서도 즉시 뜨는 것과 같은 "없어지는 실패 모드"라 무해하다.
  useEffect(() => {
    dialogRef.current?.showModal();
    // autoFocus 속성은 여기서 무효다 — React 는 커밋 시점에 .focus() 를 대신 부르는데 그땐
    // dialog 가 아직 닫혀 있어(UA 의 display:none) no-op 이고, 이후 showModal 의 포커스 단계는
    // autofocus "속성"을 찾다 못 찾아 첫 포커서블(닫기 버튼)로 떨어진다. 열고 나서 직접 맞춘다.
    inputRef.current?.focus();
  }, []);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startSearch(async () => {
      setError("");
      try {
        const found = await trpc.chzzk.categorySearch.query({ query: q, size: 12 });
        setResults(found);
        if (found.length === 0) setError("검색 결과가 없어요. 다른 이름으로 찾아보세요.");
      } catch (e) {
        // 실패한 검색의 이전 결과를 남기면 방금 검색어와 무관한 게임을 붙이게 된다 — 비운다.
        setResults([]);
        setError(messageFor(e, "검색에 실패했어요. 잠시 후 다시 시도해 주세요."));
      }
    });
  }

  function onPick(c: ChzzkCategory) {
    startAdd(async () => {
      setError("");
      try {
        const row = await trpc.games.add.mutate({
          categoryId: c.categoryId,
          categoryType: "GAME",
          categoryValue: c.categoryValue,
          posterImageUrl: c.posterImageUrl,
        });
        // 닫기는 close() 로 — 포커스가 트리거(addslot)로 복원되고, 부모 언마운트는 onClose
        // 이벤트가 위임한다. onAdded 는 보드에 행을 낙관적으로 얹는다.
        dialogRef.current?.close();
        onAdded(row);
      } catch (e) {
        setError(messageFor(e, "추가에 실패했어요."));
      }
    });
  }

  // 배경(::backdrop) 클릭만 닫는다. 카드 박스 밖 좌표일 때만(헤더 패딩까지 닫지 않게), 그리고
  // 입력에서 시작한 드래그 선택이 밖에서 놓여도 닫히지 않게 "누른 지점도 밖"일 때만 닫는다.
  const pressedOutside = useRef(false);
  function isOutside(e: React.MouseEvent<HTMLDialogElement>) {
    const d = dialogRef.current;
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return !(
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
    );
  }
  function onBackdropMouseDown(e: React.MouseEvent<HTMLDialogElement>) {
    pressedOutside.current = isOutside(e);
  }
  // close() 를 부르면 브라우저의 dialog 닫기 알고리즘이 실행돼 포커스가 트리거(addslot)로
  // 복원된다 — onClose(부모 언마운트)를 직접 부르면 열린 채로 DOM 에서 제거돼 포커스가 body
  // 로 떨어진다. 실제 언마운트는 dialog 의 onClose 이벤트가 부모에게 위임한다.
  function onBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (pressedOutside.current && isOutside(e)) dialogRef.current?.close();
    pressedOutside.current = false;
  }

  return (
    <dialog
      className="composer paper"
      ref={dialogRef}
      aria-labelledby="composer-title"
      data-od-id="composer"
      onClose={onClose}
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <button
        className="composer__close"
        type="button"
        aria-label="닫기"
        onClick={() => dialogRef.current?.close()}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="composer__body">
        <h2 className="composer__title" id="composer-title">
          게임 추가
        </h2>
        <p className="composer__hint">치지직 게임 카테고리를 검색해 보드에 붙여요.</p>

        <form className="composer__search" onSubmit={onSearch}>
          <input
            className="field"
            type="search"
            placeholder="게임 이름으로 검색"
            value={query}
            ref={inputRef}
            onChange={(e) => setQuery(e.target.value)}
            data-od-id="composer-input"
          />
          <button className="btn btn--secondary composer__btn" type="submit" disabled={searching}>
            {searching ? "검색 중…" : "검색"}
          </button>
        </form>

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        <ul className="composer__results" data-od-id="composer-results">
          {results.map((c) => (
            <li key={c.categoryId}>
              <button
                className="composer__pick"
                type="button"
                disabled={adding}
                onClick={() => onPick(c)}
              >
                {c.posterImageUrl ? (
                  <img
                    className="composer__poster"
                    src={c.posterImageUrl}
                    alt=""
                    width={40}
                    height={53}
                    loading="lazy"
                  />
                ) : (
                  <span className="composer__noposter" aria-hidden="true">
                    {c.categoryValue.charAt(0)}
                  </span>
                )}
                <span className="composer__pickname">{c.categoryValue}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
