"use client";

import { useEffect, useRef, useState } from "react";

/* 발행·비공개 전환 확인(이슈 #56 결정 21). 게임 폼의 `GameDialog`(+ `dialog-shell`·
   `dialog-history`)를 재사용하지 않는다 — `schedule.css` 가 이미 games 의 dialog/composer CSS
   에 안 기댄다고 정해 뒀고(편집기 회귀 격리), 이 확인은 딥링크가 필요 없는 단발성 예/아니오라
   히스토리 엔트리(뒤로가기가 이 모달만 닫는 계약)를 끌고 올 이득이 없다. `game-dialog.tsx` 의
   `DiscardConfirm`(같은 파일의 미저장 확인 — 그것도 히스토리 없이 네이티브 dialog 하나로 충분한
   가장 가까운 선례)과 같은 최소 구성을 따른다: 포커스 트랩·Esc·배경 inert·닫을 때 포커스 복원은
   전부 `showModal()` 이 준다. 배경 클릭으로는 안 닫는다(DiscardConfirm 과 같은 선택 — 이 확인은
   서버 쓰기를 다루므로 실수로 스치는 클릭에 안 걸려야 한다).

   busy 인 동안(전환 요청이 날아가는 중)은 Esc·버튼을 잠근다 — GameDialog 의 busy 잠금과 같은
   이유(인계 경쟁 방지, 그 파일 주석 참고). */

export function PublishConfirmDialog({
  odId,
  mode,
  publishing,
  error,
  onConfirm,
  onClose,
}: {
  odId: string;
  mode: "publish" | "unpublish";
  /* 부모(schedule-save 머신)의 publishing 상태 그대로 — 이 다이얼로그가 지금 막 보낸 요청인지는
     아래 submitted 로 가른다(머신은 인스턴스당 하나라 다른 화면의 발행 시도와 안 섞인다). */
  publishing: boolean;
  // 부모 머신의 publishError. submitted 이전엔 무시한다(이전 시도의 묵은 에러가 새로 연 창에
  // "방금 실패했다"로 잘못 읽히지 않게).
  error: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = odId + "-title";
  const hintId = odId + "-hint";
  // 이 창에서 확인을 눌렀는가 — 누르기 전엔 publishing·error 가 이전 시도의 잔재일 수 있다.
  const [submitted, setSubmitted] = useState(false);
  const busy = submitted && publishing;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // 이 창에서 보낸 요청이 끝났고(더는 publishing 이 아니고) 에러도 없으면 성공 — 닫는다.
  useEffect(() => {
    if (submitted && !publishing && error === "") onClose();
  }, [submitted, publishing, error, onClose]);

  const title = mode === "publish" ? "발행하시겠습니까?" : "비공개로 전환하시겠습니까?";
  const hint =
    mode === "publish"
      ? "발행하면 이번 주 일정이 공개되고, 보드에 플레이 날짜가 뜹니다."
      : "비공개로 전환하면 이번 주 일정이 더는 공개되지 않습니다. 보드의 플레이 날짜는 그대로 남습니다.";
  const confirmLabel = mode === "publish" ? "발행" : "비공개로 전환";
  const confirmBusyLabel = mode === "publish" ? "발행 중…" : "전환 중…";

  return (
    <dialog
      className="sched-confirm paper"
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      aria-busy={busy || undefined}
      data-od-id={odId}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <h2 className="sched-confirm__title" id={titleId}>
        {title}
      </h2>
      <p className="sched-confirm__hint" id={hintId}>
        {hint}
      </p>

      {submitted && error && (
        <p className="sched-err" role="alert">
          {error}
        </p>
      )}

      <div className="sched-confirm__actions">
        <button
          type="button"
          className="btn btn--secondary sched-confirm__btn"
          data-od-id={odId + "-cancel"}
          disabled={busy}
          onClick={() => ref.current?.close()}
        >
          취소
        </button>
        <button
          type="button"
          className="btn btn--primary sched-confirm__btn"
          data-od-id={odId + "-confirm"}
          disabled={busy}
          onClick={() => {
            setSubmitted(true);
            onConfirm();
          }}
        >
          {busy ? confirmBusyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
