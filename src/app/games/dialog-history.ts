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
export type PopHandler = () => boolean;

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

export function claimEntry(owner: PopHandler) {
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

export function abandonEntry(owner: PopHandler) {
  /* 셸이 **닫히지 않은 채** 사라졌다 — StrictMode 의 중간 정리이거나, 모달 안 링크로 페이지를
     떠난 경우다. 되돌리지 않는다: 여기서 back 을 부르면 이탈 자체를 무르고, StrictMode 에선
     방금 쌓은 엔트리를 곧바로 걷어내 두 번째 셋업이 다시 쌓게 된다. 주인만 놓아 다음
     뒤로가기가 이 엔트리를 조용히 소비하게 둔다(위 한계 (1)). */
  if (entryOwner === owner) entryOwner = null;
}

export function releaseEntry(owner: PopHandler) {
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
