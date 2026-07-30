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

import { useCallback, useRef, useState, type RefObject } from "react";
import { useMachine } from "@xstate/react";
import { isAborted } from "@/core/error-message";
import { createSubmitMachine } from "@/core/submit.machine";
import type { WeekCardData } from "@/features/schedule/card";
import { WeekCard } from "./week-card";
import { WeekCardZoomDialog } from "./week-card-zoom-dialog";

const CARD_WIDTH = 1200;

/* html-to-image 기본값은 window.devicePixelRatio 를 그대로 쓴다 — 그러면 같은 주를 아이폰과
   데스크톱에서 내려받은 PNG 픽셀 치수가 달라져 작업순서 4 의 e2e 가 치수를 단정할 수 없다.
   2 로 못박아 카페·트위터에 올려도 흐릿하지 않을 해상도(2400×1260)를 모든 기기에서 보장한다. */
const PIXEL_RATIO = 2;

/* weekStartDate 뿐 아니라 card 도 함께 싣는다 — 이유는 아래 startCapture 주석("card 로 캐시를
   가른다"). */
type DownloadValues = { weekStartDate: string; card: WeekCardData };

const downloadMachine = createSubmitMachine<DownloadValues, void>();

/* 서버 코드가 없는 순수 클라이언트 동작이라 error-message.ts 의 코드 분기 매퍼들과 다르지만,
   "기다리다 멈췄다"(isAborted)만은 같은 뜻을 공유한다 — submit 머신이 15초 뒤 이 run 에 넘기는
   AbortSignal(아래 capture)이 그 시간을 못 지키면 이 갈래로 온다. 그 밖엔 실패해도 로컬에서
   아무 부작용도 안 남으므로("저장됐을 수도"류의 애매함이 없다) 원인을 단정하지 않고 그대로
   다시 시도해 보라고만 말한다. */
function downloadErrorMessage(e: unknown): string {
  if (isAborted(e))
    return "카드를 만드는 데 시간이 너무 오래 걸려서 멈췄습니다. 다시 시도해 주십시오.";
  return "카드를 만들지 못했습니다. 다시 시도해 주십시오.";
}

function downloadFileName(weekStartDate: string): string {
  return `챠이로쿠냐_주간일정_${weekStartDate}.png`;
}

// signal 이 이미 중단됐거나 나중에 중단되면 그 reason 으로 거절하는 프라미스 — 아래 capture 의
// Promise.race 짝이다. html-to-image 는 AbortSignal 을 안 받으므로 직접 경주를 붙인다.
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason as unknown);
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason as unknown), { once: true });
  });
}

/* 클릭 시점 노드를 그대로 복제해 화면 밖에 숨긴 채로 캡처한다(평이한 리뷰 지적, 라운드 5) —
   살아있는 nodeRef.current 를 그대로 넘기면 아래 import("html-to-image")·document.fonts.ready
   를 기다리는 사이(비동기 틈)에도 <WeekCard> 는 이 컴포넌트의 최신 props 로 계속 다시 그려진다.
   읽기 화면은 WeekNav 로 주가 바뀌어도 리마운트를 안 하므로(아래 run 주석과 같은 사정), 그
   틈에 사용자가 다음 주로 넘어가면 클릭 당시엔 이번 주였던 바로 그 노드가 toPng 이 실제로 도는
   시점엔 이미 다음 주 내용으로 바뀌어 있다 — 파일명은 클릭 시점 weekStartDate 그대로인데
   그림은 그 사이 바뀐 주가 찍혀 나간다. cloneNode 는 동기 호출이라 이 줄과 다음 await 사이엔
   아무 틈도 없다 — onClick → send → (XState 가 동기로 invoke 하는) run → capture →
   startCapture 까지 전부 같은 동기 구간이므로, 클릭 그 순간의 DOM 을 그대로 얼려 둔다.

   화면 밖으로 치워도 body 에는 붙여 둔다 — computed style·레이아웃(오프셋·폭)은 실제로 문서
   트리에 앉아 있어야 나오고, 떨어져 나간 조각은 레이아웃이 없어 html-to-image 가 치수를 못
   읽는다. 디자인 토큰(globals.css 의 :root 변수)은 문서 어디에 붙든 그대로 상속되므로(이
   컴포넌트가 var() 로만 색을 읽는 week-card.tsx 와 같은 전제) 시각 결과는 원본과 같다.

   ── 화면 밖으로 치우는 스타일은 **감싸는 상자**에 건다(2026-07-30, 이슈 #122) ──────────
   복제본 자신에 `position: fixed; top/left: -10000px` 을 걸면 **받아지는 PNG 가 통째로 빈다.**
   html-to-image 는 노드를 SVG `<foreignObject>` 안에 넣어 래스터화하는데, 그때 computed style 을
   인라인으로 베낀다 — `position: fixed` 는 그 안에서 SVG 뷰포트 기준이 되어 카드가 -10000px 에
   놓이고, 1200×630 화폭엔 아무것도 안 그려진다(실측: 생성된 SVG 의 루트 style 에
   `inset: -10000px 10080px 10090px -10000px`, 래스터 결과는 전 픽셀 알파 0).
   감싸는 상자는 캡처 대상이 아니라 그 스타일이 SVG 로 안 새고, 복제본은 원본대로
   `position: relative` 를 유지한다.

   **이 결함은 게이트 전부 초록인 채로 살아 있었다** — e2e 가 PNG 매직 바이트와 2400×1260 만
   봤기 때문이다. 빈 그림도 유효한 PNG 이고 치수도 맞다. 그래서 같은 PR 이 "받은 PNG 의 팬아트
   자리 픽셀"을 재는 스펙을 함께 넣는다(schedule.spec.ts). */
function snapshotCard(node: HTMLDivElement): { clone: HTMLDivElement; dispose: () => void } {
  const clone = node.cloneNode(true) as HTMLDivElement;
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.top = "-10000px";
  holder.style.left = "-10000px";
  holder.setAttribute("aria-hidden", "true");
  holder.appendChild(clone);
  document.body.appendChild(holder);
  return { clone, dispose: () => holder.remove() };
}

/* 캡처 전에 카드 안 그림을 **우리가** data URL 로 바꿔 끼우고 디코드까지 끝낸다(이슈 #122).

   html-to-image 도 같은 일을 하지만(embed-images.js 의 embedImageNode) 그 결과가 그림을 **한 번씩
   빠뜨린다.** 실측(2026-07-30, 같은 세션에서 6번 연속 캡처): 1·3·4·5·6번은 팬아트가 담겼고
   **2번만 통째로 비었다.** 생성된 SVG 를 뜯어 보면 2번에도 `src="data:image/png;base64,…"` 가
   제대로 들어 있다 — 즉 **인라인이 아니라 래스터화가 진다.** 1번은 네트워크에서 받아 오느라
   (요청 로그에 `fetch`) 시간이 걸리는 사이 브라우저가 그 data URL 을 디코드해 두는데, 2번은
   라이브러리 캐시에 맞아 요청이 없어(로그에 `image` 만) SVG 를 곧바로 그리고, 그때 안쪽 그림이
   아직 디코드 전이라 빈 자리로 래스터된다. 3번부터는 디코드 캐시가 데워져 다시 나온다.

   그래서 **같은 문자열을 미리 이 문서에서 디코드해 둔다** — `img.decode()` 가 끝나면 그 data URL
   의 비트맵이 브라우저 캐시에 있으므로, SVG 안의 같은 data URL 은 그릴 때 바로 나온다. 덤으로
   라이브러리의 fetch 가 사라져 왕복이 하나 준다.

   실패하면 **주소를 그대로 둔다** — html-to-image 가 예전처럼 자기 경로로 시도한다(오늘과 같은
   상태로 떨어질 뿐 더 나빠지지 않는다). 그림 한 장 때문에 일정 카드 전체를 못 받게 만들 이유가
   없다. `decode` 가 없는 환경(테스트용 DOM 구현)에선 그 단계만 건너뛴다. */
async function inlineImages(root: HTMLElement): Promise<void> {
  const targets = [...root.querySelectorAll("img")].filter((img) => !img.src.startsWith("data:"));
  await Promise.all(
    targets.map(async (img) => {
      try {
        const res = await fetch(img.src);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
        if (typeof img.decode === "function") await img.decode();
      } catch {
        // 위 주석 — 원래 주소를 그대로 두고 라이브러리에 맡긴다.
      }
    }),
  );
}

type InFlightMap = Map<string, Promise<string>>;

/* 캐시 키는 오브젝트 참조가 아니라 "그 주 + 그 내용" 문자열이다(라운드 6 적대적 리뷰) — 참조로
   가르면(라운드 5의 첫 시도) 같은 주·같은 내용을 다시 만나도 매번 새 오브젝트라(읽기 화면은
   네비게이션마다 서버가 새로 내려주고, 편집기도 useMemo 는 baseline 이 그대로일 때만 참조를
   지켜 주는 최적화일 뿐 이 캐시가 기대야 할 계약은 아니다) 캐시가 못 맞물린다. 문자열 키는
   참조가 달라도 내용이 같으면 그대로 맞아떨어지므로, "같은 주에 내용이 바뀌면 새로 캡처한다"
   (라운드 5)와 "같은 내용을 다시 만나면 진행 중인 캡처를 재사용한다"(이번 라운드) 양쪽을
   내용 동일성이라는 하나의 규칙으로 만족시킨다. */
function captureKey(weekStartDate: string, card: WeekCardData): string {
  return `${weekStartDate}:${JSON.stringify(card)}`;
}

/* 물리적으로 진행 중인 캡처를 "그 주 + 그 내용" 키마다 여러 개 동시에 추적한다(Map, 라운드 6
   적대적 리뷰) — 위 Promise.race 는 화면을 제때 풀어 재시도할 수 있게 하지만, 진 쪽
   (html-to-image 내부 작업)을 취소하지는 않는다. 한때 항목을 하나만(가장 최근 카드) 들고
   있었는데, 그러면 주 A 캡처가 시간 초과로 화면만 풀린 채 배경에서 도는 동안 주 B 로 넘어가
   캡처하면 그 하나짜리 항목이 B 로 덮어써지고, 그 뒤 다시 A 로 돌아와 눌러도(내용은 그대로인
   A) 배경에서 아직 도는 A 의 캡처를 더는 못 찾아 세 번째 물리적 캡처를 또 시작했다 — WeekNav
   로 주를 오가는 흔한 조작 앞에서 "재시도를 하나로 묶는다"는 이 캐시의 목적 자체가 무의미해질
   뻔했다. Map 은 키가 다른 여러 항목을 동시에 들고 있을 수 있어, A 든 B 든 나중에 같은 키로
   다시 찾아오면 배경에서 아직 도는 바로 그 캡처를 돌려준다.

   **안 끝나는 캡처가 서로 다른 키로 계속 쌓이는 한계는 알고 수용한다(라운드 7 적대적 리뷰가
   같은 축을 다시 지적 — 이 맵 항목뿐 아니라 각 항목이 물고 있는 1200×630 복제 DOM(snapshot)
   까지 문서에 남는다는 점을 더 구체적으로 짚었다).** 이 상태에 이르려면 실제로 매 시도가(느린
   폰트 임베드 폴백처럼) 진짜로 "느린" 게 아니라 **영영 settle 을 안 해야** 하고 — fetch 는
   브라우저·OS 레벨 타임아웃이 있어 실전에서 이 조건 자체가 거의 안 일어난다 — 그 위에 사용자가
   서로 다른 주를 계속 눌러야 두 조건이 겹친다. snapshot 을 toPng 이 끝나기 전에 미리 떼는
   방안도 검토했다: html-to-image 는 자기 나름의 clone 을 또 뜨는데(node_modules/html-to-image/
   lib/clone-node.js 의 cloneSingleNode, 일반 엘리먼트는 `node.cloneNode()`) 캔버스·비디오·
   iframe 이 아닌 이 카드 노드라면 그 내부 clone 은 동기에 가까워 빨리 끝난다 — 그러니 원리상
   snapshot 이 필요한 시간은 짧다. 그런데 "얼마 뒤에 지운다"는 타이머 기반 어림값이라, 그 시간을
   못 지키는 드문 기기에서는 **평범한(정상적으로 끝나는) 캡처마저 중간에 대상을 잃어 깨진 그림을
   만들 위험**이 생긴다 — 극히 드문 누수 하나를 없애려고 흔한 경로에 새 타이밍 의존 결함을
   심는 셈이라(saveWeek 의 D1 트랜잭션 없음과 같은 결, "구멍을 다른 구멍으로 옮긴다") 채택하지
   않았다. 완벽한 상한(LRU 등)을 두는 대신 이 정도의 극단적 반복 조작만 수용 경계 밖으로 남겨
   둔다(AGENTS "현실적 사고" 원칙과 같은 결, 이슈 #109 작업순서 3 코멘트에 기록).

   컴포넌트 인스턴스의 ref 에 두는 이유(모듈 스코프가 아니라): 리마운트되면(편집기의 key 교체)
   새 맵으로 새로 시작하는 것도 맞다(언마운트된 옛 노드의 캡처를 기다릴 이유가 없다). */
function startCapture(
  node: HTMLDivElement,
  key: string,
  inFlightRef: RefObject<InFlightMap | null>,
): Promise<string> {
  const map = (inFlightRef.current ??= new Map());
  const current = map.get(key);
  if (current) return current;

  const snapshot = snapshotCard(node);
  const promise = (async () => {
    try {
      const [{ toPng }] = await Promise.all([import("html-to-image"), document.fonts.ready]);
      await inlineImages(snapshot.clone);
      return await toPng(snapshot.clone, { pixelRatio: PIXEL_RATIO });
    } finally {
      snapshot.dispose();
    }
  })();
  map.set(key, promise);
  /* 이 키가 아직도 이 프라미스를 가리킬 때만 지운다 — 이론상 정산 시점 사이에 같은 키로 새
     시도가 끼어들 여지를 막는다(단일 스레드 자바스크립트라 실제로는 거의 안 일어나지만, 이전
     단일 항목 캐시에서도 같은 이유로 이 확인을 뒀다).

     `.finally()`는 새 프라미스를 반환하고 그 프라미스는 `promise`가 거절되면 같이 거절된다 —
     실패 자체는 이 함수가 반환하는 `promise`를 기다리는 쪽(race)이 이미 처리하지만, 여기서
     만든 이 파생 프라미스는 아무도 안 기다리므로 그대로 두면 처리 안 된 거절로 잡힌다. 진짜
     실패 전파와 무관한 부수 효과일 뿐이라 조용히 삼킨다. */
  promise
    .finally(() => {
      if (map.get(key) === promise) map.delete(key);
    })
    .catch(() => {});
  return promise;
}

/* 복제 원본은 항상 스케일 없는 1200×630 week-card 노드다(week-card.tsx 주석 — 조상의 transform
   은 복제 대상 노드의 computed style 에 안 들어오므로, 미리보기 축소와 무관하게 clone 은 항상
   실제 크기로 찍힌다). fontEmbedCSS 를 직접 만들지 않고 기본 임베딩에 맡긴다 — 이 사이트 폰트는
   구글 폰트 cross-origin <link> 라 기본 구현이 sheet.cssRules 직접 접근 대신 fetch 폴백을 타는데
   (html-to-image embed-webfonts.js), dom 테스트는 이 모듈을 mock 하고 e2e(작업순서 4)는 PNG
   매직 바이트만 보므로 폴백 폰트로 찍혀도 게이트는 전부 초록이다(옛 Satori "…" 두부 사건과
   같은 자리) — 그래서 실제 다운로드 결과물을 **눈으로 확인했다**(2026-07-27, Playwright 로
   발행된 주를 저장 → 다운로드 → PNG 를 직접 열어 --font-hand 가 정확히 나온 것을 확인, 콘솔의
   SecurityError 는 직접 접근 실패 뒤 fetch 폴백이 도는 과정에서 나는 양성 경고다). 기본값으로
   충분하다는 뜻이지, "이 배선의 검증 불가 지점"이라는 뜻이 아니다 — 이 코드나 이 사이트의 폰트
   로딩 방식(layout.tsx 의 <link>)이 바뀌면 이 확인을 다시 해야 한다.

   signal 을 반드시 받아 경주 붙인다(적대적 리뷰 지적) — 서버 요청과 달리 fetch 기반이 아니라
   신호를 그냥 무시해도 타입은 통과하지만, 폰트 임베드가 위 SecurityError 폴백 경로처럼 느려지거나
   막히면 toPng 이 영영 안 끝나 버튼이 "만드는 중…"에 붙박인다 — 새로고침 말고는 빠져나갈 길이
   없다. `toPng` 에 `fetchRequestInit: {signal}` 을 넘겨 라이브러리 차원의 취소를 시키는 대신
   race 로 화면만 풀어 주는 이유: 실측(html-to-image embed-webfonts.js `fetchCSS`)으로 확인한
   바, 이 앱이 실제로 타는 느린 경로(cross-origin CSS 텍스트 자체를 fetch 로 받는 폴백)는 애초에
   그 옵션을 안 받는 plain `fetch(url)` 라 신호를 넘겨도 그 단계는 안 끊긴다 — 부분적으로만
   먹는 보호로 안전하다고 착각하는 것보다, race + 위 in-flight 재사용으로 화면 복구와 작업
   상한을 각각 확실히 보장하는 쪽을 택했다. */
async function capture(
  node: HTMLDivElement,
  card: WeekCardData,
  weekStartDate: string,
  signal: AbortSignal,
  inFlightRef: RefObject<InFlightMap | null>,
): Promise<void> {
  const dataUrl = await Promise.race([
    startCapture(node, captureKey(weekStartDate, card), inFlightRef),
    rejectOnAbort(signal),
  ]);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = downloadFileName(weekStartDate);
  a.click();
}

/* 받을 수 없는 이유. **null 이면 받을 수 있다.**

   전엔 이 자리가 `card === null`(미발행) 하나였고 미저장은 경고 문구로만 알렸다. 미리보기가
   draft 를 그리게 되면서 편집기의 `card` 는 절대 null 이 아니게 됐고(schedule-editor.tsx),
   그러면 그 판정이 통째로 닿지 않는 가지가 된다 — **미발행인데 저장은 된 주에서 이유 없이
   잠긴 버튼**이 남는다(advisor 지적). 그건 이 PR 이 휴방에서 고친 것과 정확히 같은 부류다:
   가드는 방어선이고 잠금은 표시다. 그래서 사유를 값으로 받아 각각 문장으로 말한다. */
export type DownloadBlockedReason = "unpublished" | "unsaved";

const BLOCKED_MESSAGE: Record<DownloadBlockedReason, string> = {
  unpublished: "발행된 주만 카드로 내려받을 수 있습니다.",
  /* **"지금 받으면 마지막 저장분이 나갑니다"에서 바뀌었다.** 그때는 받을 수 있었고 화면과 파일이
     다를 뿐이었는데, 이제 그 차이 자체를 없앴다(미저장이면 못 받는다) — 문구도 경고가 아니라
     "무엇을 하면 풀리는가"를 말한다. */
  unsaved: "저장하지 않은 변경이 있습니다. 저장하면 이 카드를 받을 수 있습니다.",
};

export function WeekCardDownload({
  card,
  weekStartDate,
  blockedReason = null,
}: {
  card: WeekCardData | null;
  weekStartDate: string;
  /* 편집기만 넘긴다. 읽기 화면은 발행된 주만 렌더하므로(`card` 가 null 이면 미발행) 이 값이
     필요 없고, 넘기지 않으면 아래에서 `card === null` 이 그대로 "미발행"으로 읽힌다. */
  blockedReason?: DownloadBlockedReason | null;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef<InFlightMap | null>(null);
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
         호출 시점에 새로 읽으므로 안전하다(state 와 다르다). weekStartDate·card 는 정확히 그
         "렌더마다 바뀌는 값"이라 여기서 클로저로 읽으면 안 된다 — 읽기 화면은 이 컴포넌트를
         key 없이 그리므로(schedule-editor 와 달리) WeekNav 로 다음 주로 넘어가도 리마운트가
         안 돼 이 run 클로저가 **첫 마운트 때의 값에 영영 고정**된다(적대적 리뷰가 잡은 자리 —
         캡처되는 그림은 매번 새 카드로 맞지만 파일명만 첫 주에 고정됐다). submit 머신의 계약대로
         클릭 시점의 값은 submit 이벤트의 values 로 실어 보낸다. */
      run: async (values, signal) => {
        const node = nodeRef.current;
        if (!node) throw new Error("week-card 노드가 아직 마운트되지 않았습니다");
        await capture(node, values.card, values.weekStartDate, signal, inFlightRef);
      },
      mapError: downloadErrorMessage,
    },
  });
  const capturing = state.matches("submitting");
  const error = state.context.error;
  /* 원본 크기로 보는 창. 미리보기가 열 폭에 맞춰 축소되므로(창 1300 에서 배율 0.633) 글자
     수준 확인은 여기서 한다. **좁은 폭에서도 남긴다** — 그 폭에선 미리보기가 아예 감춰지므로
     (아래 CSS) 이 창이 유일한 판독 수단이 된다. */
  const [zoomed, setZoomed] = useState(false);

  /* 카드가 없으면(읽기 화면의 미발행 주) 그릴 것 자체가 없다 — 그 사정은 곧 "미발행"이다.
     편집기는 카드를 항상 넘기므로 이 갈래를 안 탄다(`blockedReason` 이 대신 말한다). */
  const blocked: DownloadBlockedReason | null = card === null ? "unpublished" : blockedReason;

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
        <p className="week-card-download__hint" data-od-id="week-card-download-blocked">
          {BLOCKED_MESSAGE.unpublished}
        </p>
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

      {/* **잠긴 이유는 언제나 화면에 있다.** 버튼만 흐려 두면 "왜 안 눌리지"가 되고, 그건 이
          PR 이 휴방에서 고친 것과 같은 부류다(가드는 방어선, 잠금은 표시). */}
      {blocked && (
        <p className="week-card-download__hint" data-od-id="week-card-download-blocked">
          {BLOCKED_MESSAGE[blocked]}
        </p>
      )}

      {error && (
        <p className="sched-err" role="alert">
          {error}
        </p>
      )}

      {/* 조작 둘은 한 줄에 선다. **확대 버튼은 미리보기 바깥이다** — 미리보기는 `aria-hidden`
          이라(카드 글자가 본문과 그대로 겹쳐 두 번 낭독된다) 그 안에 인터랙티브를 두면 보조
          기술에서 닿지 않는 버튼이 된다. */}
      <div className="week-card-download__acts">
        <button
          className="btn btn--secondary week-card-download__btn"
          type="button"
          data-od-id="week-card-download-zoom"
          onClick={() => setZoomed(true)}
        >
          원본 크기로 보기
        </button>
        <button
          className="btn btn--secondary week-card-download__btn"
          type="button"
          disabled={capturing || blocked !== null}
          data-od-id="week-card-download-btn"
          onClick={() => send({ type: "submit", values: { weekStartDate, card } })}
        >
          {capturing ? "만드는 중…" : "PNG 다운로드"}
        </button>
      </div>

      {zoomed && (
        <WeekCardZoomDialog card={card} odId="week-card-zoom" onClose={() => setZoomed(false)} />
      )}
    </div>
  );
}
