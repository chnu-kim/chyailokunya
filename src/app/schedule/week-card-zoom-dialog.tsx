"use client";

import { useEffect, useRef } from "react";
import type { WeekCardData } from "@/features/schedule/card";
import { WeekCard } from "./week-card";

/* 주간표 카드를 **원본 크기(1200×630)로** 보는 창(2026-07-31).

   왜 필요한가: 편집기 오른쪽 열의 미리보기는 열 폭에 맞춰 축소된다(창 1300 에서 배율 0.633).
   배치·잘림·팬아트 앉음새는 그 배율에서도 보이지만, 공지가 두 줄을 넘었는지 · 표기가 어디서
   말줄임됐는지 같은 **글자 수준 확인**은 원본이라야 한다. 받아 보고 확인하는 길도 있지만 그건
   발행·저장을 먼저 해야 하므로 "짜는 중에 확인한다"가 안 된다.

   ── 레시피는 `publish-confirm-dialog.tsx` 를 그대로 잇는다 ────────────────────────
   네이티브 `dialog` + `showModal()` — 포커스 트랩·Esc·배경 inert·닫을 때 포커스 복원을 전부
   브라우저가 준다(손으로 짜면 조용히 틀린다, kunya-design §5). 다만 이쪽은 **읽기 전용**이라
   두 가지가 다르다: 배경 클릭으로 닫히고(서버 쓰기가 없어 실수로 스쳐도 잃는 게 없다),
   `role` 을 `alertdialog` 로 올리지 않는다(결정을 요구하지 않는다).

   ── **카드에 ref 를 안 건다** ─────────────────────────────────────────────────
   `WeekCardDownload` 는 `nodeRef` 하나로 캡처 대상을 잡는데, 여기서 같은 ref 를 물리면 두 번째
   마운트가 그걸 덮고 **닫을 때 null 로 만들어** 다음 다운로드가 "노드가 마운트되지 않았습니다"로
   죽는다. 확대본은 보여 주기만 하는 사본이라 캡처와 무관하다.

   ── `identified={false}` ────────────────────────────────────────────────────
   같은 이유의 짝: `WeekCard` 는 `data-od-id="week-card"` 와 `week-card-day-*` 를 내부에 다는데,
   같은 값이 한 화면에 둘이면 Playwright strict 로케이터가 무관한 단언에서 깨진다. */

export function WeekCardZoomDialog({
  card,
  odId,
  onClose,
}: {
  card: WeekCardData;
  odId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = odId + "-title";

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      className="sched-zoom"
      ref={ref}
      aria-labelledby={titleId}
      data-od-id={odId}
      onClose={onClose}
      /* 배경 클릭으로 닫는다. `dialog` 자신이 배경까지 포함한 상자라, 클릭 대상이 **정확히**
         dialog 일 때만(=안쪽 내용이 아닐 때) 닫아야 카드 위 클릭이 창을 안 닫는다. */
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="sched-zoom__bar">
        <h2 className="sched-zoom__title" id={titleId}>
          주간표 카드 — 원본 크기
        </h2>
        <button
          type="button"
          className="btn btn--secondary sched-zoom__close"
          data-od-id={odId + "-close"}
          onClick={() => ref.current?.close()}
        >
          닫기
        </button>
      </div>

      {/* 카드는 1200px 고정이라 좁은 화면에선 이 상자가 가로로 스크롤된다 — 축소하면 확대의
          목적이 사라지므로 여기선 자르지 않고 넘기게 둔다(kunya-design 의 "넓은 콘텐츠는 제
          상자 안에서 스크롤한다"). */}
      <div className="sched-zoom__stage">
        <WeekCard card={card} identified={false} />
      </div>
    </dialog>
  );
}
