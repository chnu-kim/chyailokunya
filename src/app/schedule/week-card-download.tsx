"use client";

/* PNG 다운로드 배선(이슈 #109 작업순서 3). week-card.tsx(작업순서 1)·buildWeekCard(작업순서 2)
   가 만든 카드를 실제로 `html-to-image` 로 캡처해 내려받는다. 발행된 주에만 활성(결정 2·5) —
   `card` 가 null 이면 미발행이라 버튼을 잠그고 이유를 알린다.

   모달로 안 여는 이유: 이슈가 "카드 미리보기를 상시 노출할지, 모달로 할지"를 미결로 남겼는데,
   모달을 쓰면 board-overlay 처럼 `dialog-history` 액터 배선까지 끌고 와야 한다(뒤로가기가
   모달만 닫아야 하는 계약, AGENTS "콤보박스·모달 히스토리" 지뢰). 이 화면엔 그 이득이 없다 —
   폼도 아니고 겹쳐 뜨는 다른 모달도 없어서, 인라인 섹션으로 충분하다.

   미리보기는 aria-hidden 이다 — 카드 안 텍스트(요일·제목·시각)가 읽기 화면·편집기 본문과
   그대로 겹쳐, 스크린리더가 같은 일정을 두 번 낭독하게 된다(적대적 리뷰 지적). 카드는
   "다운로드될 그림"이지 새 정보가 아니므로 버튼 이름만 남긴다. */

import { useCallback, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import { createSubmitMachine } from "@/core/submit.machine";
import type { WeekCardData } from "@/features/schedule/card";
import { WeekCard } from "./week-card";

const CARD_WIDTH = 1200;

/* html-to-image 기본값은 window.devicePixelRatio 를 그대로 쓴다 — 그러면 같은 주를 아이폰과
   데스크톱에서 내려받은 PNG 픽셀 치수가 달라져 작업순서 4 의 e2e 가 치수를 단정할 수 없다.
   2 로 못박아 카페·트위터에 올려도 흐릿하지 않을 해상도(2400×1260)를 모든 기기에서 보장한다. */
const PIXEL_RATIO = 2;

const downloadMachine = createSubmitMachine<undefined, void>();

// 서버 코드가 없는 순수 클라이언트 동작이라 error-message.ts 의 코드 분기 매퍼들과 다르다 —
// 실패하면 로컬에서 아무 부작용도 안 남으므로("저장됐을 수도"류의 애매함이 없다) 원인을
// 단정하지 않고 그대로 다시 시도해 보라고만 말한다.
function downloadErrorMessage(): string {
  return "카드를 만들지 못했습니다. 다시 시도해 주십시오.";
}

function downloadFileName(weekStartDate: string): string {
  return `챠이로쿠냐_주간일정_${weekStartDate}.png`;
}

/* 캡처 대상은 항상 스케일 없는 원본 1200×630 노드다(week-card.tsx 주석 — 조상의 transform 은
   복제 대상 노드의 computed style 에 안 들어오므로 미리보기 축소와 무관하게 항상 실제 크기로
   찍힌다). fontEmbedCSS 를 직접 만들지 않고 기본 임베딩에 맡긴다 — 이 사이트 폰트는 구글
   폰트 cross-origin <link> 라 기본 구현이 sheet.cssRules 직접 접근 대신 fetch 폴백을 타는데
   (html-to-image embed-webfonts.js), dom 테스트는 이 모듈을 mock 하고 e2e(작업순서 4)는 PNG
   매직 바이트만 보므로 폴백 폰트로 찍혀도 게이트는 전부 초록이다(옛 Satori "…" 두부 사건과
   같은 자리) — 그래서 실제 다운로드 결과물을 **눈으로 확인했다**(2026-07-27, Playwright 로
   발행된 주를 저장 → 다운로드 → PNG 를 직접 열어 --font-hand 가 정확히 나온 것을 확인, 콘솔의
   SecurityError 는 직접 접근 실패 뒤 fetch 폴백이 도는 과정에서 나는 양성 경고다). 기본값으로
   충분하다는 뜻이지, "이 배선의 검증 불가 지점"이라는 뜻이 아니다 — 이 코드나 이 사이트의 폰트
   로딩 방식(layout.tsx 의 <link>)이 바뀌면 이 확인을 다시 해야 한다. */
async function capture(node: HTMLDivElement, weekStartDate: string): Promise<void> {
  const [{ toPng }] = await Promise.all([import("html-to-image"), document.fonts.ready]);
  const dataUrl = await toPng(node, { pixelRatio: PIXEL_RATIO });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = downloadFileName(weekStartDate);
  a.click();
}

export function WeekCardDownload({
  card,
  weekStartDate,
  stale = false,
}: {
  card: WeekCardData | null;
  weekStartDate: string;
  /* 편집기에서만 참일 수 있다 — 카드는 baseline(저장된 값)으로 그리는데, 그 편집기 폼엔
     저장 안 한 변경(dirty)이 남아 있을 수 있다는 뜻이다(schedule-editor.tsx 가 isWeekDirty 를
     그대로 넘긴다). 신호가 없으면 "왜 폼과 미리보기가 다르지 / 지금 받으면 뭐가 나오지"가
     된다(팬 제안의 "값 기준이 다르면 화면에도 신호가 없다"와 같은 자리, AGENTS 참고) — 그래서
     저장을 권하는 힌트를 얹는다. 읽기 화면은 이 prop 을 아예 안 넘긴다(baseline 개념이 없다). */
  stale?: boolean;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  /* 미리보기를 컨테이너 폭에 맞춰 축소한다(1200px 는 안 넘김 — 확대는 안 한다). useEffect
     안에서 동기 setState 를 하면 AGENTS 지뢰(react-hooks/set-state-in-effect, Next 16 error)
     에 걸린다(use-theme.ts 와 같은 함정) — 콜백 ref 로 우회한다. ResizeObserver 콜백은
     effect 본문의 동기 실행이 아니라 브라우저가 나중에 부르는 별도 콜백이라 그 규칙의
     대상이 아니다. */
  const previewRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / CARD_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [state, send] = useMachine(downloadMachine, {
    input: {
      /* nodeRef 는 마운트 시점에 얼어붙지 않는다 — submit.machine.ts 의 "얼어붙음"은 렌더마다
         바뀌는 컴포넌트 **값**(state)에 해당하고, ref 객체는 그대로 캡처되되 `.current` 는
         호출 시점에 새로 읽으므로 안전하다(state 와 다르다). */
      run: async () => {
        const node = nodeRef.current;
        if (!node) throw new Error("week-card 노드가 아직 마운트되지 않았습니다");
        await capture(node, weekStartDate);
      },
      mapError: downloadErrorMessage,
    },
  });
  const capturing = state.matches("submitting");
  const error = state.context.error;

  if (!card) {
    return (
      <div className="week-card-download" data-od-id="week-card-download">
        <button
          className="btn btn--secondary week-card-download__btn"
          type="button"
          disabled
          data-od-id="week-card-download-btn"
        >
          PNG 다운로드
        </button>
        <p className="week-card-download__hint">발행된 주만 카드로 내려받을 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="week-card-download" data-od-id="week-card-download">
      <div className="week-card-download__preview" ref={previewRef} aria-hidden="true">
        <div className="week-card-download__scale" style={{ transform: `scale(${scale})` }}>
          <WeekCard card={card} ref={nodeRef} />
        </div>
      </div>

      {stale && (
        <p className="week-card-download__hint" data-od-id="week-card-download-stale">
          저장하지 않은 변경이 있습니다. 지금 받으면 마지막으로 저장한 내용이 나갑니다.
        </p>
      )}

      {error && (
        <p className="sched-err" role="alert">
          {error}
        </p>
      )}

      <button
        className="btn btn--secondary week-card-download__btn"
        type="button"
        disabled={capturing}
        data-od-id="week-card-download-btn"
        onClick={() => send({ type: "submit", values: undefined })}
      >
        {capturing ? "만드는 중…" : "PNG 다운로드"}
      </button>
    </div>
  );
}
