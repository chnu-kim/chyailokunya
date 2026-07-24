"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* 게임 보드의 모달 키트 — 컴포저(추가)와 클리어 수정이 둘 다 쓴다. 두 번째 호출자가 생기면서
   드러난 seam 이라 여기로 뺐다(ADR-0010 의 JIT 추상화). 담는 건 둘이다: 네이티브 dialog 셸과
   클리어 상태(플래그 + 선택적 날짜) 입력. 실패 문구는 error-message.ts 로 나갔다 — 이 파일이
   React 를 끌어와 단위 테스트가 안 붙었고, 그래서 "400 에 네트워크 탓 문구가 뜨는" 결함이
   테스트 없이 프로덕션까지 갔다.

   표면이 .paper 인 이유: .polaroid 는 --border-strong 을 안 되돌려 다크에서 입력 테두리가
   크림 위 1.01:1 로 사라진다. .paper 위에선 14.3:1 이라 폼은 반드시 이쪽에 올린다. */

/* 네이티브 <dialog>+showModal() 을 쓰는 이유: 포커스 트랩·Esc 닫기·배경 inert·top-layer·
   닫을 때 트리거로 포커스 복원을 전부 브라우저가 준다(직접 만든 백드롭 div 는 이걸 더 나쁘게
   재구현한다). 진입 애니메이션·스크림·바텀시트는 games.css 의 dialog.composer 가 그린다. */
export function GameDialog({
  title,
  odId,
  closing,
  busy = false,
  describedBy,
  alert = false,
  closeButton = true,
  onClose,
  children,
}: {
  title: string;
  odId: string;
  /* 부모가 "이제 닫아라"를 말하는 신호(작업 완료·취소). 콜백 대신 값인 이유: close 함수를
     children 으로 내려보내면 react-hooks/refs 가 렌더 중 ref 접근으로 읽어 error 를 낸다.
     신호를 값으로 받으면 실제 ref 접근이 effect 안에서만 일어난다. */
  closing: boolean;
  /* 서버 쓰기가 날아가는 중인가. 그동안은 닫기를 셋 다 잠근다(X 버튼·::backdrop·Esc).

     왜 잠그나: 호출자는 "성공하면 행을 쥐고 closing 만 세우고, 실제 인계는 브라우저가
     dialog 를 닫은 뒤 오는 onClose 이벤트에서 한다"는 규약을 쓴다. 쓰기가 in-flight 인 동안
     사용자가 먼저 닫으면 close 이벤트가 앞질러 도착하고, 그때 added/saved 는 아직 null 이라
     취소 경로를 타 컴포넌트가 언마운트된다 — 뒤늦게 성공한 뮤테이션의 setState 는 no-op 이
     되어 행이 부모에게 영영 안 넘어간다. 서버엔 들어갔는데 보드엔 카드도 안내도 없고,
     실패로 읽은 사용자가 다시 추가하면 CONFLICT 를 본다.

     왜 "언마운트 뒤에도 ref 로 인계"가 아닌가: 그러면 쓰기 도중 모달이 사라지고 잠시 뒤
     보드가 혼자 바뀌는 화면이 된다 — 무슨 일이 일어났는지 사용자가 추적할 수 없다. 잠깐
     못 닫는 쪽이 정직하다. 잠금은 네트워크 왕복 한 번 동안뿐이고, 이유는 버튼의
     "추가 중…"/"저장 중…" 과 aria-busy 가 말한다. */
  busy?: boolean;
  /* 제목과 **함께** 읽힐 설명 요소의 id. 공백으로 여럿 나열할 수 있다(IDREF 목록).

     왜 필요한가: showModal() 뒤 포커스는 DOM 첫 포커서블(X 가 있으면 .composer__close,
     없으면 본문 첫 컨트롤)로 가므로, aria-labelledby 만 걸면 스크린리더가 읽는 건 "제목 · 대화상자 · 닫기 버튼"이 전부다.
     본문에 무엇이 걸려 있는지(어느 게임인지, 되돌릴 수 있는지)는 사용자가 직접 훑어야
     알게 되는데, 파괴 확인에선 그게 유일한 안전장치다. describedBy 로 이어 두면 열리는
     순간 함께 낭독된다. 포스터는 alt="" 라 아무것도 안 싣는다 — 이름을 따로 가리켜야 한다. */
  describedBy?: string;
  /* role="alertdialog" 로 올린다. 되돌릴 수 없는 확인에만 켠다 — 이 role 은 "설명을 읽지
     않고 확정하면 복구가 없다"는 종류의 다이얼로그를 위한 것이고, AT 가 열림과 동시에
     설명을 낭독하는 근거가 된다(describedBy 와 한 쌍이다). 네이티브 <dialog>+showModal 이
     주는 포커스 트랩·Esc·배경 inert·top-layer 는 role 과 무관하게 그대로다. */
  alert?: boolean;
  /* 모서리 X 를 그릴지. **본문에 "취소"가 있으면 끈다** — 같은 일을 하는 손잡이 둘이 한 화면에
     있으면 사용자는 차이를 찾느라 멈춘다("X 는 취소와 다른 건가?"). 닫는 길은 X 를 빼도 셋이
     남는다: 취소 버튼 · Esc · 배경 클릭.
     켜 두는 건 취소가 없는 다이얼로그뿐이다(컴포저의 2차 버튼은 "뒤로"라 검색 단계로 돌아갈
     뿐 닫지 않는다 — 거기선 X 가 유일한 닫기다).
     부수 효과가 하나 있고 그게 파괴 확인에선 이득이다: 첫 포커서블이 X 에서 "취소"로 바뀌어
     열리자마자 **안전한 쪽**에 포커스가 선다. */
  closeButton?: boolean;
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
  /* 셸 자신의 닫기(모서리 X·배경 클릭)는 이벤트 핸들러라 ref 를 직접 만져도 된다.
     busy 면 아무것도 안 한다 — busy prop 주석의 인계 경쟁을 막는 잠금이다. 부모가 세우는
     closing 신호는 이 잠금을 거치지 않는다(성공해서 닫는 길이라 경쟁이 없다). */
  const close = useCallback(() => {
    if (busy) return;
    dialogRef.current?.close();
  }, [busy]);

  return (
    <dialog
      className="composer paper"
      ref={dialogRef}
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      data-od-id={odId}
      aria-busy={busy || undefined}
      onClose={onClose}
      /* Esc 는 close() 를 거치지 않고 UA 가 직접 닫는다 — cancel 을 막아야 잠금이 성립한다. */
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onMouseDown={(e) => {
        pressedOutside.current = isOutside(e);
      }}
      onClick={(e) => {
        if (pressedOutside.current && isOutside(e)) close();
        pressedOutside.current = false;
      }}
    >
      {closeButton && (
        <button
          className="composer__close"
          type="button"
          aria-label="닫기"
          disabled={busy}
          onClick={close}
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
      )}

      <div className="composer__body">
        <h2 className="composer__title" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

/* 클리어 편집의 폼 상태. 플래그(정본)와 선택적 날짜 한 쌍이다 — DB 의 cleared·cleared_date 를
   그대로 옮긴 모양이다. 날짜의 "모름"은 빈 문자열 하나뿐이어야 한다(서버 dateInput 이 null 로
   전처리한다 — 중복 정규화 금지). */
export type ClearedDraft = { cleared: boolean; clearedDate: string };

/* 클리어 수정 모달 전용 — editing 이 null 을 거쳐 매번 리마운트되므로 폼 상태를 여기서 들어도
   이월이 없다. 컴포저는 반대로 한 번 마운트된 채 여러 게임을 거치지만, 이제 클리어를 add 단계에
   두지 않으므로(추가 뒤 편집으로 붙인다) 이 상태는 편집 모달에만 산다. */
export function useClearedDraft(initial: ClearedDraft) {
  const [draft, setDraft] = useState(initial);
  return { draft, setDraft };
}

/* 클리어 플래그 + 선택적 날짜. 체크가 정본이고 날짜는 그 아래 딸린다 — 안 깬 게임에 날짜만
   있는 모순을 UI 에서부터 막으려고, 체크를 풀면 날짜 입력을 감추고 값도 비운다(서버 CHECK·
   Zod 가 최종 방어선이지만, 화면에서 애초에 그 조합을 못 만들게 한다). 체크가 켜졌는데 날짜가
   비면 "깼는데 날짜 모름"이라 그대로 유효하다 — 그 표현을 살리는 게 플래그를 날짜와 독립으로
   둔 이유다. type=date 라 형식·실재성(2026-02-31)은 브라우저가 먼저 막는다. */
export function ClearedFields({
  draft,
  onChange,
  idPrefix,
  firstFieldRef,
}: {
  draft: ClearedDraft;
  onChange: (next: ClearedDraft) => void;
  idPrefix: string;
  // 모달 오픈 시 포커스를 여기로 옮기려는 호출자를 위한 손잡이(체크박스가 첫 조작점).
  firstFieldRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="clearfields">
      <label className="clearfields__toggle" htmlFor={idPrefix + "-cleared"}>
        <input
          type="checkbox"
          checked={draft.cleared}
          id={idPrefix + "-cleared"}
          ref={firstFieldRef}
          data-od-id={idPrefix + "-cleared"}
          // 체크를 풀면 날짜도 비운다 — 안 깬 게임에 클리어 날짜가 남지 않게(CHECK 의 UI 짝).
          onChange={(e) =>
            onChange(
              e.target.checked ? { ...draft, cleared: true } : { cleared: false, clearedDate: "" },
            )
          }
        />
        <span className="clearfields__togglelabel">클리어했어요</span>
      </label>
      {draft.cleared && (
        <label className="datefield">
          <span className="datefield__label">클리어한 날 (모르면 비워 둬요)</span>
          <input
            className="field"
            type="date"
            value={draft.clearedDate}
            id={idPrefix + "-date"}
            data-od-id={idPrefix + "-date"}
            onChange={(e) => onChange({ ...draft, clearedDate: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
