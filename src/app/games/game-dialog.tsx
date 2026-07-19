"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isDateOrderValid } from "@/core/games";
import type { DatePair } from "@/core/games-composer";

/* 게임 보드의 모달 키트 — 컴포저(추가)와 날짜 수정이 둘 다 쓴다. 두 번째 호출자가 생기면서
   드러난 seam 이라 여기로 뺐다(ADR-0010 의 JIT 추상화). 담는 건 셋이다: 네이티브 dialog 셸,
   tRPC 에러 코드 → 한국어 문구, 그리고 플레이/클리어 날짜 한 쌍의 입력.

   표면이 .paper 인 이유: .polaroid 는 --border-strong 을 안 되돌려 다크에서 입력 테두리가
   크림 위 1.01:1 로 사라진다. .paper 위에선 14.3:1 이라 폼은 반드시 이쪽에 올린다. */

/* tRPC 에러 **코드**로 분기한다 — 서버 문구 매칭(msg.includes("이미"))은 문구를 다듬는 순간
   조용히 죽는다. 세션 만료·권한 없음은 재시도로 안 풀리므로 실행 가능한 조치를 안내한다. */
export function messageFor(e: unknown, fallback: string): string {
  const code = (e as { data?: { code?: string } } | null)?.data?.code;
  if (code === "CONFLICT") return "이미 보드에 있는 게임이에요.";
  if (code === "NOT_FOUND") return "보드에 없는 게임이에요. 새로고침해 주세요.";
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN")
    return "로그인이 만료됐거나 권한이 없어요. 다시 로그인해 주세요.";
  return fallback;
}

/* 네이티브 <dialog>+showModal() 을 쓰는 이유: 포커스 트랩·Esc 닫기·배경 inert·top-layer·
   닫을 때 트리거로 포커스 복원을 전부 브라우저가 준다(직접 만든 백드롭 div 는 이걸 더 나쁘게
   재구현한다). 진입 애니메이션·스크림·바텀시트는 games.css 의 dialog.composer 가 그린다. */
export function GameDialog({
  title,
  odId,
  closing,
  onClose,
  children,
}: {
  title: string;
  odId: string;
  /* 부모가 "이제 닫아라"를 말하는 신호(작업 완료·취소). 콜백 대신 값인 이유: close 함수를
     children 으로 내려보내면 react-hooks/refs 가 렌더 중 ref 접근으로 읽어 error 를 낸다.
     신호를 값으로 받으면 실제 ref 접근이 effect 안에서만 일어난다. */
  closing: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = odId + "-title";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // dev 의 StrictMode 는 effect 를 두 번 돌린다 — 이미 열린 dialog 에 showModal 을 다시 부르면
    // InvalidStateError 가 나 모달이 통째로 깨진다. 열려 있으면 건너뛴다.
    if (!dialog.open) dialog.showModal();
    // 정리에서 close() 를 부르지 않는다 — close 이벤트가 onClose 로 이어져 StrictMode 의 두 번째
    // 셋업 전에 부모가 모달을 닫아버린다. 언마운트되면 브라우저가 top layer 에서 알아서 뺀다.
  }, []);

  /* close() 를 부르면 브라우저의 dialog 닫기 알고리즘이 실행돼 포커스가 트리거로 복원된다 —
     부모가 곧장 언마운트하면 열린 채로 DOM 에서 제거돼 포커스가 body 로 떨어진다. 실제
     언마운트는 dialog 의 onClose 이벤트가 부모에게 위임한다. */
  useEffect(() => {
    if (closing) dialogRef.current?.close();
  }, [closing]);

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
  // 셸 자신의 닫기(모서리 X·배경 클릭)는 이벤트 핸들러라 ref 를 직접 만져도 된다.
  const close = useCallback(() => dialogRef.current?.close(), []);

  return (
    <dialog
      className="composer paper"
      ref={dialogRef}
      aria-labelledby={titleId}
      data-od-id={odId}
      onClose={onClose}
      onMouseDown={(e) => {
        pressedOutside.current = isOutside(e);
      }}
      onClick={(e) => {
        if (pressedOutside.current && isOutside(e)) close();
        pressedOutside.current = false;
      }}
    >
      <button className="composer__close" type="button" aria-label="닫기" onClick={close}>
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
        <h2 className="composer__title" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

export type { DatePair };

/* 날짜 두 개는 optional 이라 기본값을 비워 둔다 — "오늘"을 심으면 "플레이한 날을 모른다"가
   표현 불가능해지고, 사용자가 안 지운 기본값이 사실인 척 저장된다(core 의 todayKST 를 끝내
   아무도 안 부른 이유가 이 결정이다). 빈 문자열은 서버의 dateInput 이 null 로 전처리한다
   (중복 정규화 금지 — 여기선 그대로 넘긴다).

   순서 검증은 서버 addGameInput/updateGameInput 의 refine 이 정본이고, 여기 것은 왕복 한 번을
   아끼는 편의다. type=date 라 형식·실재성(2026-02-31)은 브라우저가 먼저 막는다. */
export function dateOrderError(dates: DatePair): string {
  return isDateOrderValid(dates.playedAt || null, dates.clearedAt || null)
    ? ""
    : "클리어한 날이 플레이한 날보다 앞설 수는 없어요.";
}

/* 날짜 수정 모달 전용 — editing 이 null 을 거쳐 매번 리마운트되므로 폼 상태를 여기서 들어도
   이월이 없다. 컴포저는 반대로 한 번 마운트된 채 여러 게임을 거치므로 날짜를 상태 기계
   (core/games-composer)가 들고 선택 전환마다 비운다. */
export function useDatePair(initial: DatePair) {
  const [dates, setDates] = useState(initial);
  return { dates, setDates, orderError: dateOrderError(dates) };
}

export function DateFields({
  dates,
  onChange,
  idPrefix,
  firstFieldRef,
}: {
  dates: DatePair;
  onChange: (next: DatePair) => void;
  idPrefix: string;
  // 단계 전환 후 포커스를 여기로 옮기려는 호출자(컴포저)를 위한 손잡이.
  firstFieldRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="datefields">
      <label className="datefield">
        <span className="datefield__label">플레이한 날</span>
        <input
          className="field"
          type="date"
          value={dates.playedAt}
          id={idPrefix + "-played"}
          ref={firstFieldRef}
          data-od-id={idPrefix + "-played"}
          onChange={(e) => onChange({ ...dates, playedAt: e.target.value })}
        />
      </label>
      <label className="datefield">
        <span className="datefield__label">클리어한 날</span>
        <input
          className="field"
          type="date"
          value={dates.clearedAt}
          id={idPrefix + "-cleared"}
          data-od-id={idPrefix + "-cleared"}
          onChange={(e) => onChange({ ...dates, clearedAt: e.target.value })}
        />
      </label>
    </div>
  );
}
