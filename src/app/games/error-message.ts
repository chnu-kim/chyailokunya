/* 실패 → 사용자에게 보일 한국어 문구.

   **원칙: 문구는 우리가 확인한 것만 말한다.** 추상화는 하되 없는 사실을 지어내지 않는다.
   프로덕션에서 이 원칙을 어겼다 — categoryId 길이 상한에 걸린 400 에 "네트워크가 느린 것
   같아요. 저장됐을 수도 있으니 새로고침해 확인한 뒤 다시 시도해 주세요" 가 떴다. 셋 다 거짓이다:
   네트워크는 멀쩡했고, 저장된 적 없고, 재시도로는 절대 안 풀린다. 원인을 모를 때 가는 fallback
   자리에 원인을 단정하는 문구를 둔 게 화근이었다.

   그래서 우리가 **실제로 확인할 수 있는 것 두 가지**로만 분기한다:

   1. 서버가 코드를 줬나? → 줬다면 요청은 서버에 닿았고 서버가 판단했다. 네트워크 얘기를
      꺼낼 근거가 없다.
   2. 우리가 기다리기를 멈췄나?(timeout) → 멈춘 건 기다림이지 요청이 아니다. 서버에 닿았는지도,
      저장됐는지도 모른다.

   둘 다 아니면 정말 모르는 것이고, 그때는 **원인을 말하지 않는다.**

   에러 코드로 분기한다 — 서버 문구 매칭(msg.includes("이미"))은 문구를 다듬는 순간 조용히 죽는다. */

/* 모든 tRPC 호출에 거는 상한. 이 값이 없으면 promise 가 settle 을 안 하는 경우(Workers 응답
   지연, 프록시가 소켓을 붙잡은 채 놓지 않음)에 useTransition 의 pending 이 영영 안 내려간다 —
   쓰기 중엔 busy 가 X·배경·Esc·뒤로·취소를 전부 잠그므로 새로고침이 유일한 탈출이 되고, 그건
   사용자가 방금 입력한 날짜를 버린다. reject 는 catch 가 잡지만 "끝나지 않음"은 아무도 안
   잡으므로 상한이 유일한 방어선이다.

   15초인 이유: 사용자가 "멈췄다"고 느끼기 전에는 풀려야 하고(그 체감은 대략 10초대 초반부터
   시작한다), 느린 모바일 회선의 **정상** 왕복은 넘겨야 한다 — 짧게 잡으면 성공할 요청을
   끊어 "저장됐는지 모른다" 상태를 우리가 만들어 낸다. */
export const REQUEST_TIMEOUT_MS = 15_000;

/* AbortSignal.timeout 은 AbortError 가 아니라 **TimeoutError** DOMException 으로 끊는다. 둘 다
   본다 — 앞으로 사용자 취소(AbortError)를 붙여도 같은 분기로 들어오게. tRPC 는 원인을 감싸
   던지므로 cause 체인을 끝까지 훑는다(D1 의 UNIQUE 를 찾을 때와 같은 이유). */
export function isAborted(e: unknown): boolean {
  for (let cur = e; cur; cur = (cur as { cause?: unknown }).cause) {
    const name = (cur as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") return true;
  }
  return false;
}

function codeOf(e: unknown): string | null {
  return (e as { data?: { code?: string } } | null)?.data?.code ?? null;
}

/* 이 코드들은 서버가 **쓰기를 시작하기 전에** 거절했다는 뜻이다 — 입력 검증·인가·중복·부재.
   그래서 "저장되지 않았다"고 단정해도 거짓이 아니다. 여기 없는 코드(INTERNAL_SERVER_ERROR,
   앞으로 생길 것들)는 서버가 어느 단계에서 죽었는지 모르므로 단정하지 않는다. */
const REJECTED_BEFORE_WRITE = new Set([
  "BAD_REQUEST",
  "CONFLICT",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PRECONDITION_FAILED",
]);

/** 코드가 있든 없든 공통으로 말이 되는 것들. 없으면 null 을 돌려 호출자별 분기로 넘긴다. */
function sharedMessage(code: string | null): string | null {
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN")
    return "로그인이 만료됐거나 권한이 없어요. 다시 로그인해 주세요.";
  return null;
}

/* 읽기(검색) 실패. 읽기는 "저장됐을까" 하는 애매함이 없어서 실패를 단정해도 된다 — 다만
   원인은 여전히 아는 만큼만 말한다. */
export function readErrorMessage(e: unknown): string {
  if (isAborted(e)) return "검색이 너무 오래 걸려서 멈췄어요. 다시 시도해 주세요.";
  const code = codeOf(e);
  const shared = sharedMessage(code);
  if (shared) return shared;
  // 치지직 자격증명이 없을 때 서버가 내는 코드. 사용자가 재시도해도 안 풀리니 그렇게 말한다.
  if (code === "PRECONDITION_FAILED")
    return "지금은 게임 검색을 쓸 수 없어요. 잠시 뒤에 다시 열어볼게요.";
  return "검색에 실패했어요. 잠시 후 다시 시도해 주세요.";
}

/* 쓰기(추가·수정) 실패. 핵심은 **"저장됐는지 우리가 아느냐"** 를 문구가 정확히 반영하는 것이다.
   안다고 말할 수 있을 때만 단정하고, 모르면 모른다고 하고 확인 방법을 준다. */
export function writeErrorMessage(e: unknown): string {
  /* 응답을 못 들었다. 멈춘 건 기다림이지 요청이 아니라서, 서버에 닿았는지도 저장됐는지도
     모른다 — 그건 말하되 네트워크 탓이라고 단정하지는 않는다(우리가 아는 건 "오래 걸렸다"뿐). */
  if (isAborted(e))
    return "응답이 너무 오래 걸려서 기다리기를 멈췄어요. 저장됐을 수도 있으니 새로고침해 확인해 주세요.";

  const code = codeOf(e);
  const shared = sharedMessage(code);
  if (shared) return shared;

  if (code === "CONFLICT") return "이미 보드에 있는 게임이에요.";
  if (code === "NOT_FOUND") return "보드에 없는 게임이에요. 새로고침해 주세요.";
  /* 우리 입력 경계에 걸렸다 = 우리 쪽 결함이다. 사용자가 고칠 수 있는 게 없고 재시도로도
     안 풀리니, 재시도를 권하는 대신 그 사실을 알린다. */
  if (code === "BAD_REQUEST")
    return "이 게임은 지금 보드에 넣을 수 없어요. 저장되지 않았어요 — 알려 주시면 고칠게요.";

  /* 서버가 코드를 줬으니 요청은 닿았다. 여기까지 온 코드는 우리가 안 다루는 종류인데,
     REJECTED_BEFORE_WRITE 에 있으면 쓰기 전에 거절됐음이 확실하므로 단정할 수 있다. */
  if (code && REJECTED_BEFORE_WRITE.has(code))
    return "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";

  /* 남은 둘: (a) 서버가 코드를 줬지만 어느 단계에서 죽었는지 모르는 경우(INTERNAL_SERVER_ERROR
     등), (b) 코드도 없고 abort 도 아닌 경우(연결 실패, isAborted 가 못 알아본 중단). 둘 다
     저장 여부를 모른다 — **원인을 말하지 않고** 확인 방법만 준다. 정직함이 isAborted 나
     코드 목록의 완전성에 매달리지 않도록, 모를 때의 기본값은 항상 이쪽이다. */
  return "저장됐는지 확인하지 못했어요. 새로고침해서 확인해 주세요.";
}

/* 삭제 실패. writeErrorMessage 를 그대로 쓰면 안 된다 — 그 문구는 전부 **저장** 기준이라
   삭제를 누른 사용자에게 뜻이 정확히 뒤집혀 전달된다("저장됐을 수도 있으니 새로고침해
   확인해 주세요"). 삭제가 이 갈래를 못 받은 건 역사 때문이다: 지연 커밋 시절엔 실패가
   자국 안 announcement 로만 흘러 이 함수에 닿은 적이 없었고, ADR-0020 이 즉시 커밋으로
   바꾸며 처음으로 사용자 눈앞에 뜨게 됐다.

   조작 명사만 바꾼 게 아니라 **도달 가능한 코드 집합이 다르다** — 그래서 verb 파라미터가
   아니라 별도 함수다. remove 는 CONFLICT 를 낼 수 없고, 없는 id 는 오류가 아니라
   `deleted:false` 성공이라 NOT_FOUND 도 안 온다(service.removeGame 의 멱등성 주석).
   그 둘의 문구("이미 보드에 있는 게임이에요"·"보드에 없는 게임이에요")를 삭제판에 두면
   도달하지도 않을 거짓말을 유지보수하게 된다. 분기 구조와 판단 근거는 위와 같다 —
   isAborted / sharedMessage / REJECTED_BEFORE_WRITE 를 그대로 공유한다. */
export function deleteErrorMessage(e: unknown): string {
  // 멈춘 건 기다림이지 요청이 아니다 — 서버에 닿았는지도, 지워졌는지도 모른다.
  if (isAborted(e))
    return "응답이 너무 오래 걸려서 기다리기를 멈췄어요. 삭제됐을 수도 있으니 새로고침해 확인해 주세요.";

  const code = codeOf(e);
  const shared = sharedMessage(code);
  if (shared) return shared;

  // 쓰기 전에 거절된 게 확실한 코드 — 삭제에선 인가 실패(위 shared)와 입력 검증뿐이다.
  if (code && REJECTED_BEFORE_WRITE.has(code))
    return "삭제하지 못했어요. 잠시 후 다시 시도해 주세요.";

  // 모를 때의 기본값(INTERNAL_SERVER_ERROR·연결 실패). 원인을 말하지 않고 확인 방법만 준다.
  return "삭제됐는지 확인하지 못했어요. 새로고침해서 확인해 주세요.";
}
