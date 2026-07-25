"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatMD } from "@/core/calendar";
import { formatDate, isPlayDateEditable } from "@/core/games";

/* 게임 보드의 모달 키트 — 컴포저(추가)와 클리어 수정이 둘 다 쓴다. 두 번째 호출자가 생기면서
   드러난 seam 이라 여기로 뺐다(ADR-0010 의 JIT 추상화). 담는 건 둘이다: 네이티브 dialog 셸과
   클리어 상태(플래그 + 선택적 날짜) 입력. 실패 문구는 error-message.ts 로 나갔다 — 이 파일이
   React 를 끌어와 단위 테스트가 안 붙었고, 그래서 "400 에 네트워크 탓 문구가 뜨는" 결함이
   테스트 없이 프로덕션까지 갔다.

   표면이 .paper 인 이유: .polaroid 는 --border-strong 을 안 되돌려 다크에서 입력 테두리가
   크림 위 1.01:1 로 사라진다. .paper 위에선 14.3:1 이라 폼은 반드시 이쪽에 올린다. */

/* ── 다이얼로그를 브라우저 히스토리에 얹는다 ────────────────────────────────────────
   안 얹으면 안드로이드 하드웨어 뒤로가기·iOS 스와이프가 모달이 아니라 **페이지를 떠난다**
   (이슈 #65). 모달을 여는 것이 사용자에겐 "한 걸음 들어간 것"이라 뒤로가기가 그 한 걸음만
   무르는 게 맞다.

   **셸이 쥔다.** 한때 이 배선이 보드(GameBoard)에 있었고 상세만 태웠는데, 그러면 잃을 게
   없는 상세는 히스토리로 보호받고 **유일하게 미저장 입력을 든 컴포저는 안 받는** 비대칭이
   된다 — 같은 /games 안에서 뒤로가기가 화면에 따라 "모달 닫기"와 "페이지 이탈 + 입력 소실"로
   갈렸다(리뷰 실측). 셸로 올리면 뒤로가기가 셸의 다른 닫기 셋(X·배경·Esc)과 같은
   dirty·busy 잠금을 그대로 거친다.

   **모듈 스코프인 이유:** 되돌리는 주체와 다음에 여는 주체가 서로 다른 컴포넌트 인스턴스다 —
   닫는 셸은 history.back() 을 부르고 곧 언마운트되는데 그 back 은 **비동기 브라우저 왕복**
   이라(20배 CPU 스로틀에서 0~90ms 실측) 도착 전에 다음 셸이 벌써 마운트돼 있을 수 있다.
   인스턴스별 ref 로는 그 사실을 전할 수 없다. 애초에 히스토리는 문서 하나에 하나뿐인 전역
   상태라 여기 모델도 전역인 게 맞다.

   **URL 은 안 바꾼다.** pushState 의 url 인자를 생략하면 주소가 유지된 채 엔트리만 쌓인다.
   딥링크는 열지 않기로 한 결정이라(/games/[id] 라우트를 안 만든다 — routes.ts 가 nav 와
   로그인 복귀 허용목록의 공동 정본이라 라우트를 늘리면 거기까지 딸려온다) 주소를 바꾸면
   오히려 거짓말이 된다: 그 주소를 새로고침해도 모달이 없다.

   **알고 수용한 한계 둘.** (1) 모달을 연 채 그 안의 링크로 다른 페이지에 가면(수정 폼이
   여러 날 편성일 때 내주는 /schedule 링크) 이 엔트리가 그대로 남아, 돌아올 때 뒤로가기 한
   번이 아무 일도 안 한 것처럼 보인다. 언마운트 정리에서 back 을 부르면 그 이탈 자체를
   되돌려 버리므로 여기선 안 고친다.

   (2) **엔트리가 문서를 넘어 살아남는 자리 둘** — 앞으로가기와 새로고침이다. 우리 엔트리는
   히스토리에 남는데 그 엔트리가 가리키던 모달 상태는 메모리에만 있었으므로, 돌아오면
   **뒤로가기 한 번이 소리 없이 소비된다**(실측: 열기 → 뒤로 → 앞으로 → 뒤로 = /games 그대로,
   한 번 더 눌러야 이탈. 새로고침도 같다 — 열어 둔 채 새로고침 → 뒤로 = /games 그대로).
   새로고침 쪽이 훨씬 흔한 조작이라 이쪽을 먼저 적는다.
   고치려면 무엇이 열려 있었는지를 엔트리 state 에 실어야 하는데, 그 값을 실으면 "주소는
   그대로인데 히스토리엔 게임 id 가 있다"는 반쪽 딥링크가 생긴다 — 딥링크를 안 열기로 한
   결정과 정면으로 부딪히므로 여는 김에 라우트까지 가야 한다(이슈 #65 의 갈래 2). */

/* 우리 엔트리에 뒤로가기가 왔을 때 셸이 내리는 판정. true = 닫았다(엔트리를 소비했다),
   false = 안 닫는다(그러면 컨트롤러가 엔트리를 다시 쌓는다). */
type PopHandler = () => boolean;

/* 엔트리의 상태가 **셋**인 이유: 불리언 하나로는 "엔트리가 있나"와 "되돌리는 중이나"를 못
   가른다. back 이 날아가는 동안(popping) 새 창이 엔트리를 또 쌓으면, 뒤늦게 도착한 popstate
   를 그 창이 자기 것으로 알고 닫아 버린다 — 리뷰가 저사양 폰(20배 스로틀)에서 실측한
   증상이 정확히 그것이다: 카드를 눌렀는데 열렸다 스스로 닫히고 히스토리는 한 칸씩 자란다
   (연타 6라운드에 length 3 → 10). 이 배선이 존재하는 이유 자체가 저사양 안드로이드라
   무시할 자리가 아니다. */
let entryState: "none" | "live" | "popping" = "none";
/* 지금 그 엔트리를 쓰는 셸. null 이면 엔트리만 남고 주인이 없다(위 한계 (1)). */
let entryOwner: PopHandler | null = null;
let listening = false;

/* 우리가 쌓은 엔트리에 박는 표식. **"엔트리가 있다"와 "그 엔트리가 지금 자리다"는 다른 것**
   이고, 그 둘을 안 가르면 버려진 엔트리를 다음 모달이 물려받는다:

     /games 에서 모달 열기(엔트리 쌓임) → 모달 안 링크로 다른 페이지 → abandonEntry 가 주인만
     놓고 entryState 는 live 로 남긴다 → 돌아와서 모달을 다시 열면 claimEntry 가 "이미 live"
     라며 안 쌓는다 → 그런데 그 live 엔트리는 **이제 현재보다 뒤에 있다** → 뒤로가기가
     페이지를 떠나는데 컨트롤러는 그걸 자기 엔트리로 알고 모달을 닫는다.

   뒤로가기가 모달만 닫는다는 이 배선의 약속이 정확히 거기서 깨진다(적대적 리뷰가 잡았다).
   그래서 표식을 박고 **현재 엔트리가 정말 우리 것인지** 확인한다. 토큰을 세는 건 같은
   문서 안에서 쌓았다 버린 옛 엔트리와 지금 것을 구별하기 위해서다 — 불리언이면 버려진
   엔트리로 뒤로가기했을 때 그것도 "우리 것"으로 읽힌다.

   **이건 딥링크가 아니다.** 위 한계 (2) 가 경계한 건 *무엇이 열려 있었는지*(게임 id)를 싣는
   것이고, 이 표식은 "이 엔트리는 모달이 쌓은 것"이라는 사실뿐이라 새로고침 뒤에도 아무것도
   복원하지 않는다. */
const ENTRY_MARK = "__gamesModalEntry";
let entryToken = 0;

function pushEntry() {
  /* 엔트리 state 는 **지금 것을 복사해 넣는다.** App Router 는 자기 라우팅 트리를
     history.state 에 들고 다니고, 그게 없는 엔트리로 이동하면(back 뒤의 forward) 라우터가
     "옛 pages 라우터가 만든 엔트리"로 보고 location.reload() 를 때린다. Next 가 pushState 를
     패치해 내부 state 를 복사해 주긴 하지만, 먼저 복사해 두면 그 패치에 기대지 않는다. */
  entryToken += 1;
  window.history.pushState({ ...window.history.state, [ENTRY_MARK]: entryToken }, "");
}

/* 지금 서 있는 히스토리 엔트리가 **우리가 마지막에 쌓은 그것**인가. */
function atOurEntry(): boolean {
  const state: unknown = window.history.state;
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[ENTRY_MARK] === entryToken
  );
}

function stopListening() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("popstate", onPopState);
}

function onPopState() {
  if (entryState === "popping") {
    /* 우리가 부른 back 이 이제야 도착했다 — **사용자의 뒤로가기가 아니다.** 그냥 흘려보내면
       그 사이 열린 창이 엔트리 없이 남아 다음 뒤로가기가 페이지를 떠나므로, 기다리는 주인이
       있으면 여기서 쌓아 넘긴다(back 이 걷어낸 자리에 도로 한 칸 — 히스토리 길이가 안 는다). */
    if (entryOwner) {
      pushEntry();
      entryState = "live";
      return;
    }
    entryState = "none";
    stopListening();
    return;
  }
  // 우리 엔트리가 아니다 — 남의 뒤로가기를 가로채면 페이지를 못 떠난다.
  if (entryState !== "live") return;
  /* live 이긴 한데 **방금 우리 엔트리를 떠난 게 아닐** 수도 있다 — 버려진 엔트리가 현재보다
     뒤에 남아 있는 동안의 다른 이동이 그렇다(claimEntry 가 그 경로를 막지만, 주인 없이 남은
     엔트리를 지나가는 이동은 여기로도 온다). 그 이동을 우리 것으로 처리하면 페이지가 떠난
     자리에서 모달만 닫히거나, 반대로 못 떠난다. 표식이 이미 없어졌으면 주인 없는 엔트리를
     소비한 것이니 상태만 내리고 넘긴다. */
  if (!entryOwner && !atOurEntry()) {
    entryState = "none";
    stopListening();
    return;
  }
  /* 되돌리기는 브라우저가 이미 했다 — 여기서 back 을 부르면 한 칸 더 가 페이지를 떠난다.
     그래서 주인의 판정을 부르기 **전에** 상태를 내린다: 판정이 태우는 close 이벤트가 곧
     releaseEntry 로 이어지는데, 그때 아직 live 면 그쪽이 back 을 한 번 더 부른다. */
  const owner = entryOwner;
  entryState = "none";
  entryOwner = null;
  if (owner && !owner()) {
    /* 못 닫았다(미저장·쓰기 중·위에 겹친 모달). 엔트리를 **다시 쌓아야** 한다 — 안 쌓으면
       「계속 작성」을 고른 뒤의 뒤로가기가 곧장 페이지를 떠난다. */
    entryOwner = owner;
    pushEntry();
    entryState = "live";
    return;
  }
  stopListening();
}

function claimEntry(owner: PopHandler) {
  if (!listening) {
    listening = true;
    window.addEventListener("popstate", onPopState);
  }
  entryOwner = owner;
  if (entryState === "popping") {
    /* popping 중이면 **지금 쌓지 않는다** — 날아가는 back 이 도로 걷어간다. 위 onPopState 가
       그 순간 쌓아 이 주인에게 넘긴다. */
    return;
  }
  /* live 인데 **그 엔트리가 현재가 아니면** 물려받지 않고 새로 쌓는다. 물려받으면 버려진
     엔트리(모달 안 링크로 떠나며 남은 것)를 다음 모달이 자기 것으로 알고, 뒤로가기가
     페이지를 떠나면서 모달을 닫는다(ENTRY_MARK 주석의 경로).

     반대로 live 이고 현재가 우리 엔트리면 그대로 쓴다: dev 의 StrictMode 는 effect 를
     셋업→정리→셋업 으로 두 번 돌리는데(그 중간 정리가 abandonEntry 다) 여기서 무조건 쌓으면
     엔트리가 둘이 돼 뒤로가기 한 번이 모달을 안 닫는다. 두 경우를 가르는 게 표식이다. */
  if (entryState === "none" || !atOurEntry()) {
    pushEntry();
    entryState = "live";
  }
}

function abandonEntry(owner: PopHandler) {
  /* 셸이 **닫히지 않은 채** 사라졌다 — StrictMode 의 중간 정리이거나, 모달 안 링크로 페이지를
     떠난 경우다. 되돌리지 않는다: 여기서 back 을 부르면 이탈 자체를 무르고, StrictMode 에선
     방금 쌓은 엔트리를 곧바로 걷어내 두 번째 셋업이 다시 쌓게 된다. 주인만 놓아 다음
     뒤로가기가 이 엔트리를 조용히 소비하게 둔다(위 한계 (1)). */
  if (entryOwner === owner) entryOwner = null;
}

function releaseEntry(owner: PopHandler) {
  /* 사용자가 **직접** 닫았다(X·배경·Esc·부모의 닫기 신호) → 쌓아 둔 엔트리를 되돌린다.
     안 되돌리면 빈 엔트리가 남아 그다음 뒤로가기가 아무 일도 안 한 것처럼 보인다.

     주인이 다르면 아무것도 안 한다. close 이벤트는 동기가 아니라 **큐**라(HTML 명세) 그
     사이에 뒤로가기가 엔트리를 이미 소비했거나 다음 다이얼로그가 가져갔을 수 있는데,
     남의 엔트리를 되돌리면 그 창이 엔트리 없이 남는다. */
  if (entryOwner !== owner) return;
  entryOwner = null;
  if (entryState !== "live") return;
  entryState = "popping";
  window.history.back();
}

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
     아니라 이 모달을 닫는다(위 컨트롤러 주석).

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
  /* 미저장 확인이 떠 있는가. 이 상태에서도 부모 dialog 는 열린 채다 — 사용자가 무엇을 잃는지
     보이는 자리에 두고 묻는다. */
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

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

  /* 우리 엔트리에 뒤로가기가 왔다. 셋 중 하나라도 걸리면 **닫지 않는다**(컨트롤러가 엔트리를
     다시 쌓는다) — 뒤로가기 하나가 셸의 잠금을 우회하면 그 잠금은 있으나 마나다.

       covered — 위에 겹친 모달이 있다. 아래만 닫으면 위가 포커스를 돌려줄 자리를 잃고, 위까지
         닫으면 제스처 하나가 아래 잠금 둘을 통째로 무른다. 그래서 이 순간의 뒤로가기는 Esc 와
         같은 대접을 받는다 — 위를 닫으면 다음 뒤로가기가 정상으로 돈다(덫이 아니라 유예다).
       busy — 서버 쓰기가 날아가는 중이다(busy prop 의 인계 경쟁).
       dirty — 미저장 입력이 있다. 셸의 다른 닫기 셋과 **같은 확인**을 띄운다. 확인이 뜬 채
         다시 와도 뒤 폼이 inert 라 값이 못 바뀌어 dirty 가 그대로고, 그래서 같은 가지로
         떨어져 확인이 유지된다 — covered 에 확인 모달을 따로 셀 필요가 없는 이유다.

     이 함수는 컨트롤러가 **주인을 식별하는 키**이기도 하다. 의존성 없는 useCallback 이라
     인스턴스마다 하나뿐이고 렌더가 바뀌어도 같다(refs·setState 만 읽으므로 성립한다). */
  const onHistoryPop = useCallback(() => {
    const now = latest.current;
    if (now.covered || now.busy) return false;
    if (now.dirty) {
      setConfirmingDiscard(true);
      return false;
    }
    /* 되돌리기는 브라우저가 이미 했다 — close() 만 태워 포커스를 트리거로 되돌린다.
       곧장 언마운트하면 dialog 가 열린 채 DOM 에서 빠져 포커스가 body 로 떨어진다. */
    dialogRef.current?.close();
    return true;
  }, []);

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
    if (busy) return;
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    dialogRef.current?.close();
  }, [busy, dirty]);

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
          if (busy) {
            e.preventDefault();
            return;
          }
          if (dirty) {
            e.preventDefault();
            setConfirmingDiscard(true);
          }
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
          onKeep={() => setConfirmingDiscard(false)}
          onDiscard={() => {
            setConfirmingDiscard(false);
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

/* 플레이 날짜 입력. 컴포저(추가)와 클리어 수정이 둘 다 쓴다.

   **여기서 고치는 건 games 컬럼이 아니라 일정 항목이다**(정본은 schedule_entries, 이슈 #56
   결정 3). 그래서 잠기는 경우가 있다: 그 게임이 여러 날 편성돼 있으면(월·화 젤다) 입력 하나로
   표현할 수 없어 날짜를 나열만 하고 /schedule 로 보낸다(core.isPlayDateEditable — 서버도 같은
   판정으로 거절한다).

   dates 가 null 이면 아직 불러오는 중이다. 그동안 입력을 잠그는 이유: 열자마자 빈 칸이 보이면
   "날짜가 없는 게임"으로 읽혀, 응답이 오기 전에 저장한 사용자가 멀쩡한 날짜를 지운다.

   발행 안 내 주의 항목은 보드에 안 뜬다(ADR-0022) — 저장은 되는데 카드에 날짜가 안 보이는
   자리라 안내 한 줄로 미리 말한다. 게임 폼은 주 메타를 안 건드리므로(service.addGame 주석)
   초안을 함부로 발행하지 않는다. */
export function PlayedDateField({
  value,
  onChange,
  idPrefix,
  dates,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  idPrefix: string;
  /* 이 게임에 걸린 일정 날짜 전부. null = 불러오는 중, [] = 없음(새 게임 포함). */
  dates: readonly string[] | null;
  disabled?: boolean;
}) {
  const locked = dates !== null && !isPlayDateEditable(dates);

  if (locked) {
    return (
      <div className="datefield" data-od-id={idPrefix + "-locked"}>
        <span className="datefield__label">플레이한 날</span>
        <p className="datefield__locked">
          {dates.map(formatMD).join(" · ")} <span>({dates.length}일)</span>
        </p>
        <p className="composer__hint">
          여러 날 편성이라 여기선 못 고칩니다 — <Link href="/schedule">일정</Link>에서 고쳐
          주십시오.
        </p>
      </div>
    );
  }

  /* 이미 걸린 항목이 있으면 비우기의 뜻이 "모름"이 아니라 **연결 해제**다 — 그 행은 일정에
     남고 이 게임과의 연결만 풀린다(service.updateGame). 같은 빈 칸이 두 뜻을 가지므로
     그 사실은 화면이 말해야 한다. */
  const hasEntry = dates !== null && dates.length === 1;
  const hintId = idPrefix + "-played-hint";

  /* 그 설명이 한때 **라벨 괄호 안**에 있었다("플레이한 날 (모르면 비워 둬요)"). 두 가지가
     겹쳐 있었다: 라벨은 11px 대문자 간격의 필드 이름 자리라 문장을 담으면 읽는 리듬이 깨지고,
     스크린리더는 그 전체를 입력의 접근 이름으로 낭독한다("플레이한 날 괄호 모르면 비워 둬요").
     이름과 설명을 갈라 라벨엔 이름만 남기고 설명은 aria-describedby 로 잇는다.

     새 게임의 "몰라도 된다"는 여기 안 적는다 — 폼 상단 안내가 날짜 둘을 한 번에 말한다.
     선택 입력임을 필드마다 되풀이하면 그게 소음이고, 연결 해제처럼 **상황에 따라 달라지는
     사실**만 필드 옆에 붙을 값이 있다. */
  return (
    <div className="datefield">
      <label className="datefield__label" htmlFor={idPrefix + "-played"}>
        플레이한 날
      </label>
      <input
        className="field"
        type="date"
        value={value}
        id={idPrefix + "-played"}
        data-od-id={idPrefix + "-played"}
        disabled={disabled || dates === null}
        aria-describedby={hasEntry ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hasEntry && (
        <p className="datefield__hint" id={hintId}>
          비우면 일정에서 이 게임과의 연결만 풀립니다.
        </p>
      )}
    </div>
  );
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
  disabled = false,
}: {
  draft: ClearedDraft;
  onChange: (next: ClearedDraft) => void;
  idPrefix: string;
  // 모달 오픈 시 포커스를 여기로 옮기려는 호출자를 위한 손잡이(체크박스가 첫 조작점).
  firstFieldRef?: React.Ref<HTMLInputElement>;
  // 서버 쓰기가 날아가는 동안 잠근다 — 그 사이 고친 값은 어차피 이번 저장에 안 실린다.
  disabled?: boolean;
}) {
  return (
    <div className="clearfields">
      <label className="clearfields__toggle" htmlFor={idPrefix + "-cleared"}>
        <input
          type="checkbox"
          checked={draft.cleared}
          id={idPrefix + "-cleared"}
          ref={firstFieldRef}
          disabled={disabled}
          data-od-id={idPrefix + "-cleared"}
          // 체크를 풀면 날짜도 비운다 — 안 깬 게임에 클리어 날짜가 남지 않게(CHECK 의 UI 짝).
          onChange={(e) =>
            onChange(
              e.target.checked ? { ...draft, cleared: true } : { cleared: false, clearedDate: "" },
            )
          }
        />
        {/* 조작의 이름이지 대답이 아니다 — 바로 아래 "클리어한 날"과 한 어휘로 선다
            (상세 값 칸이 표기형으로 돌아간 것과 같은 규약). */}
        <span className="clearfields__togglelabel">클리어함</span>
      </label>
      {draft.cleared && (
        // 라벨엔 이름만 — "모르면 비워 둬요"를 뺀 근거는 PlayedDateField 주석에 있다.
        <div className="datefield">
          <label className="datefield__label" htmlFor={idPrefix + "-date"}>
            클리어한 날
          </label>
          <input
            className="field"
            type="date"
            value={draft.clearedDate}
            id={idPrefix + "-date"}
            data-od-id={idPrefix + "-date"}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, clearedDate: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

/* 게임의 사실 두 줄(플레이한 날·클리어). 카드 상세와 **팬 제안 폼의 "지금 보드에 있는 값"** 이
   나눠 쓴다 — 두 번째 호출자가 생기며 드러난 seam 이라 여기로 뺐다(ADR-0010 의 JIT 추상화).
   두 자리가 같은 값을 다르게 적으면 팬이 제안 폼에서 본 상태와 상세에서 본 상태가 갈린다.

   정의 목록인 이유: "이름: 값" 쌍이라는 걸 마크업이 말해야 스크린리더가 둘을 이어 읽는다
   (문단 두 개로 두면 라벨과 값의 관계가 사라진다).

   **값 칸은 표기형이다 — 대화체 서술을 넣지 않는다.** 한때 "했어요"·"아직이에요"였는데, 같은
   목록의 다른 값이 '2026.03.01' 같은 표기라 이 칸만 어투가 튀어 화면이 가벼워졌다(사용자 지적,
   PR #70). 라벨이 묻고 값이 대답하는 문장이 아니라, 카드 앞면 칩("클리어")이 쓰는 어휘 그대로의
   표기다. 안내문·힌트의 다정한 해요체는 그대로다 — 저긴 값 칸이 아니다. */
export function GameFacts({
  lastPlayed,
  cleared,
  clearedDate,
  idPrefix,
}: {
  lastPlayed: string | null;
  cleared: boolean;
  clearedDate: string | null;
  // data-od-id 접두사. 상세는 "detail" 을 넘겨 기존 e2e 손잡이(detail-played·detail-cleared)를 잇는다.
  idPrefix: string;
}) {
  return (
    <dl className="detail__facts">
      <dt>플레이한 날</dt>
      <dd data-od-id={idPrefix + "-played"}>
        {lastPlayed ? formatDate(lastPlayed) : <span className="detail__none">기록 없음</span>}
      </dd>
      <dt>클리어</dt>
      <dd data-od-id={idPrefix + "-cleared"}>
        {cleared ? (
          clearedDate ? (
            <>{formatDate(clearedDate)} 클리어</>
          ) : (
            // 날짜를 모르는 클리어도 유효한 상태다 — 빈칸으로 두면 안 깬 것처럼 읽힌다.
            // 날짜가 붙은 값과 나란히 놓여야 "날짜만 모른다"가 저절로 드러난다.
            "완료"
          )
        ) : (
          <span className="detail__none">미완료</span>
        )}
      </dd>
    </dl>
  );
}
