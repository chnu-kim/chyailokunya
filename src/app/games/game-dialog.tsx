"use client";

import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { dialogShellMachine } from "@/core/dialog-shell.machine";
import { abandonEntry, claimEntry, releaseEntry } from "./dialog-history.actor";

/* 네이티브 dialog 셸 — 컴포저(추가)와 클리어 수정이 둘 다 쓴다. 두 번째 호출자가 생기면서
   드러난 seam 이라 여기로 뺐다(ADR-0010 의 JIT 추상화). 닫기 판정은 `dialog-shell.machine.ts`
   (에픽 #77 이슈 #82), 히스토리 엔트리 수명주기는 `dialog-history.machine.ts` + 그 부수효과
   계층 `dialog-history.actor.ts` 로, 클리어 상태 입력·표시 부품(PlayedDateField·ClearedFields·
   GameFacts)은 game-fields.tsx 로 갈라졌다 — 이 파일은 셸(GameDialog)과 그 미저장 확인
   (DiscardConfirm)만 남는다. 실패 문구는 core/error-message.ts 로 나갔다 — 이 파일이 React 를
   끌어와 단위 테스트가 안 붙었고, 그래서 "400 에 네트워크 탓 문구가 뜨는" 결함이 테스트 없이
   프로덕션까지 갔다.

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
  dirty = false,
  history = false,
  covered = false,
  className,
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
  /* 저장 안 한 입력이 들어 있는가. true 면 **셸이 주는 닫기**(모서리 X·배경 클릭·Esc)가
     곧바로 닫지 않고 확인을 되묻는다.

     왜 셸의 닫기만인가: 배경 클릭과 Esc 는 **오조작으로 일어난다** — 날짜를 고르려다 카드
     밖을 스치거나, 입력을 지우려고 Esc 를 눌렀는데 모달이 닫힌다. 그 자리에서 입력이 통째로
     날아가는데 신호가 하나도 없었다(사용자 지적). 반면 본문의 「취소」·「뒤로」는 사용자가
     그 결정을 고른 것이라 다시 묻는 게 성가심이다 — 그 둘은 부모가 closing 신호로 닫고,
     이 가드를 거치지 않는다. 모서리 X 는 셸 쪽에 둔다: 뜻은 명확하지만 닫기 손잡이 중
     유일하게 **좌표가 폼 바로 옆**이라 잘못 눌리는 경로가 실재한다.

     판정은 호출자 몫이다 — 무엇이 "고친 것"인지는 폼마다 다르고(컴포저는 상세 단계에 들어온
     것 자체가, 수정 모달은 열 때 읽은 값과의 차이가 기준이다) 셸은 children 안을 못 본다. */
  dirty?: boolean;
  /* 이 다이얼로그가 브라우저 히스토리 엔트리를 하나 차지하는가 — 켜면 뒤로가기가 페이지가
     아니라 이 모달을 닫는다(dialog-history.machine.ts 주석).

     켜는 건 **상세와 컴포저 둘뿐이다.** 수정·삭제·미저장 확인은 안 켠다: 겹친 모달까지
     각자 엔트리를 얹으면 뒤로가기 한 번이 몇 겹 중 어디를 닫는지 화면만 봐선 알 수 없어진다.
     그 대신 아래 covered 로 "위가 떠 있는 동안엔 아래도 안 닫는다"를 만든다. */
  history?: boolean;
  /* 내 **위에** 다른 다이얼로그가 떠 있는가. 셸은 자기 위에 뭐가 얹혔는지 못 보므로 호출자가
     알려 줘야 한다. (className 으로 넘어오는 `.composer--stacked` 와 **뜻이 반대**다 —
     그쪽은 "내가 남의 위에 겹쳐 떴다"는 스크림 규칙이고, 이건 "내가 덮여 있다"는 잠금이다.)

     history 가 켜졌을 때만 뜻이 있다: 이 상태의 뒤로가기는 아래를 닫으면 안 된다. 위 모달이
     닫힐 때 포커스가 돌아갈 자리가 아래 안에 있어 함께 사라지기 때문이다. */
  covered?: boolean;
  /* 이 카드에 더 붙일 클래스. 폭(.composer--detail)과 **내가 겹쳐 떴을 때의 스크림**
     (.composer--stacked)이 지금의 용도다 — 뒤에 이미 열린 카드가 있으면 40% 잉크를 한 겹 더
     깔 이유가 없다(가릴 페이지는 앞 카드가 이미 가렸고, 그 카드는 오히려 보여야 한다). */
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = odId + "-title";
  /* 셸의 닫기 판정(dialog-shell.machine.ts) — X·배경 클릭·Esc·뒤로가기 네 곳이 REQUEST_CLOSE
     하나로 모인다. 머신엔 context 가 없다 — busy·dirty·covered 는 렌더마다 바뀌므로 이벤트
     페이로드로 매번 싣는다(아래 latest 주석이 그 이유를 잇는다). */
  const [shellState, sendShell, shellActorRef] = useMachine(dialogShellMachine);
  /* 미저장 확인이 떠 있는가. 이 상태에서도 부모 dialog 는 열린 채다 — 사용자가 무엇을 잃는지
     보이는 자리에 두고 묻는다. */
  const confirmingDiscard = shellState.matches("confirmingDiscard");

  /* 뒤로가기 판정이 읽을 최신 값. **effect 의존성에 실으면 안 된다** — busy·dirty·covered 는
     조작마다 바뀌는데 그때마다 아래 claim effect 가 다시 돌면 엔트리를 놓았다 쌓았다 하며
     히스토리가 요동친다.

     **useLayoutEffect 다.** 평범한 effect 는 passive 라 커밋 뒤 늦게 도는데, 그 사이에 도착한
     뒤로가기는 **옛 값**을 읽는다 — 컴포저에서 게임을 고른(dirty 가 참이 된) 직후의 제스처가
     미저장 확인을 건너뛰고, 수정 모달이 열린(covered 가 참이 된) 직후의 제스처가 아래 상세를
     닫는다. 잠금을 세우려고 만든 배선이 그 순간만 잠기지 않는 것이라 창이 좁다고 넘길 자리가
     아니다(적대적 리뷰가 저사양 폰에서 90ms 창을 실측한 것과 같은 종류다). layout effect 는
     커밋 직후 **동기**로 돌아 브라우저가 다음 이벤트를 처리하기 전에 값을 맞춘다. */
  const latest = useRef({ busy, dirty, covered });
  useLayoutEffect(() => {
    latest.current = { busy, dirty, covered };
  });

  /* 우리 엔트리에 뒤로가기가 왔다. 판정(busy·covered 면 무시, dirty 면 확인, 아니면 닫기)은
     dialog-shell 머신이 진다 — game-dialog.tsx 가 손으로 셋을 다시 짜지 않는다.

     이 함수는 dialog-history 쪽이 **주인을 식별하는 키**이기도 하다. 의존성 없는 useCallback
     이라 인스턴스마다 하나뿐이고 렌더가 바뀌어도 같다(`shellActorRef`·`sendShell` 은
     useMachine 이 마운트 내내 안정적으로 주므로 성립한다). `getSnapshot()` 을 쓰는 이유는
     이 컴포넌트 렌더에 묶인 `shellState` 는 send 직후에도 한 박자 낡아 있어서다 — 지금 막
     처리한 전이의 결과를 동기로 알아야 한다(dialog-history.machine.ts 의 재진입 순서와 같은
     이유). */
  const onHistoryPop = useCallback(() => {
    sendShell({ type: "REQUEST_CLOSE", ...latest.current });
    if (!shellActorRef.getSnapshot().matches("closing")) return false;
    /* 되돌리기는 브라우저가 이미 했다 — close() 만 태워 포커스를 트리거로 되돌린다.
       곧장 언마운트하면 dialog 가 열린 채 DOM 에서 빠져 포커스가 body 로 떨어진다. */
    dialogRef.current?.close();
    return true;
  }, [sendShell, shellActorRef]);

  useEffect(() => {
    if (!history) return;
    claimEntry(onHistoryPop);
    return () => abandonEntry(onHistoryPop);
  }, [history, onHistoryPop]);

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
     closing 신호는 이 잠금을 거치지 않는다(성공해서 닫는 길이라 경쟁이 없다).
     dirty 면 닫는 대신 확인을 띄운다(dirty prop 주석). */
  const close = useCallback(() => {
    sendShell({ type: "REQUEST_CLOSE", busy, dirty, covered });
    if (shellActorRef.getSnapshot().matches("closing")) dialogRef.current?.close();
  }, [busy, dirty, covered, sendShell, shellActorRef]);

  return (
    <>
      <dialog
        /* covered = 내 **위에** 다른 카드가 떴다. 그동안은 숨는다 — 네이티브 dialog 두 장이
           top layer 에 쌓이면 아래가 그대로 드러나는데, 흰 카드 두 장이 어긋나 겹친 모습이
           그 자체로 지저분하다(사용자 지적). 닫지는 않으므로 취소하면 그대로 돌아온다
           (ADR-0023 이 지키려던 건 "돌아갈 자리"이지 "보이는 것"이 아니다).

           **미저장 확인은 이 길로 안 온다** — 그건 셸이 자기 안에서 띄우고 부모의 covered 를
           안 건드린다. 거긴 뒤가 보이는 게 근거다(무엇을 잃는지 보면서 판단해야 한다). */
        className={[
          className ? "composer paper " + className : "composer paper",
          covered && "composer--covered",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={dialogRef}
        role={alert ? "alertdialog" : undefined}
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        data-od-id={odId}
        aria-busy={busy || undefined}
        /* 닫는 길이 무엇이었든 여기로 모인다 — 히스토리 엔트리를 되돌릴 자리가 여기다.
           뒤로가기로 닫힌 길은 컨트롤러가 이미 주인을 놓았으므로 back 이 안 나간다. */
        onClose={() => {
          releaseEntry(onHistoryPop);
          onClose();
        }}
        /* Esc 는 close() 를 거치지 않고 UA 가 직접 닫는다 — cancel 을 막아야 잠금이 성립한다.
           dirty 가드도 여기서 한 번 더 건다(같은 이유로 close() 를 안 거친다). */
        onCancel={(e) => {
          sendShell({ type: "REQUEST_CLOSE", busy, dirty, covered });
          // 닫아도 되면(closing) 아무것도 안 해 브라우저의 기본 취소가 이어지게 둔다 — 직접
          // close() 를 부르는 다른 세 경로와 다르다(dialog-shell.machine.ts 의 Esc 주석).
          if (!shellActorRef.getSnapshot().matches("closing")) e.preventDefault();
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

      {confirmingDiscard && (
        <DiscardConfirm
          odId={odId}
          onKeep={() => sendShell({ type: "KEEP" })}
          onDiscard={() => {
            sendShell({ type: "DISCARD" });
            dialogRef.current?.close();
          }}
        />
      )}
    </>
  );
}

/* 미저장 확인. 부모 카드 **위에** 겹쳐 뜬다 — 무엇을 잃는지 뒤에 보이는 채로 물어야 "이걸
   닫는 게 맞나"를 판단할 수 있다. 중첩 showModal 은 브라우저가 top layer 스택으로 처리해
   부모를 inert 로 만들고, 닫으면 포커스를 원래 자리로 되돌린다(직접 만든 오버레이는 이걸
   더 나쁘게 재구현한다). 부모 dialog 의 **형제**로 렌더하는 건 마크업 중첩을 피하려는 것뿐
   이고, 화면 위 순서는 top layer 가 정한다.

   **합쇼체다.** 입력이 사라지는 건 되돌릴 수 없고, 그런 자리에서 장난기는 신뢰를 깎는다
   (AGENTS 톤 규칙의 명시적 예외 — 삭제 확인과 같은 종류의 화면이다).

   Esc 는 「계속 작성」과 같은 뜻으로 둔다(onClose → onKeep): 확인을 취소하는 안전한 쪽이고,
   Esc 두 번으로 입력이 날아가면 이 가드가 있으나 마나다. */
function DiscardConfirm({
  odId,
  onKeep,
  onDiscard,
}: {
  odId: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = odId + "-discard-title";
  const hintId = odId + "-discard-hint";
  /* 이 닫힘이 「닫기」를 눌러서인가. close 이벤트는 **동기가 아니라 큐**라(HTML 명세) 어느
     버튼으로 닫았는지가 onClose 시점엔 남아 있지 않다 — 표시해 두지 않으면 「닫기」도
     onKeep 을 한 번 태워 "계속 작성"과 "그만두기"가 같은 경로로 흐른다. */
  const discarding = useRef(false);

  useEffect(() => {
    const d = ref.current;
    // StrictMode 의 두 번째 셋업에서 이미 열린 dialog 에 showModal 을 다시 부르면 죽는다.
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      className="composer paper composer--confirm composer--stacked"
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      data-od-id={odId + "-discard"}
      onClose={() => {
        if (!discarding.current) onKeep();
      }}
    >
      <div className="composer__body">
        <h2 className="composer__title" id={titleId}>
          저장하지 않고 닫으시겠습니까?
        </h2>
        <p className="composer__hint" id={hintId}>
          작성 중인 내용은 저장되지 않고 사라집니다.
        </p>
        <div className="composer__actions">
          {/* 첫 포커서블이 안전한 쪽이 되게 「계속 작성」을 앞에 둔다(삭제 확인과 같은 규약). */}
          <button
            className="btn btn--secondary composer__btn"
            type="button"
            data-od-id={odId + "-discard-keep"}
            onClick={() => ref.current?.close()}
          >
            계속 작성
          </button>
          <button
            className="btn composer__btn composer__btn--danger"
            type="button"
            data-od-id={odId + "-discard-go"}
            /* close() 로 UA 의 닫기 알고리즘을 태워야 포커스가 돌아간다 — 곧바로 언마운트하면
               포커스가 body 로 떨어진다(부모 dialog 가 쓰는 규약과 같다). */
            onClick={() => {
              discarding.current = true;
              ref.current?.close();
              onDiscard();
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </dialog>
  );
}
