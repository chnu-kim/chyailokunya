import { describe, expect, it } from "vitest";
import {
  deleteErrorMessage,
  isAborted,
  readErrorMessage,
  updateErrorMessage,
  writeErrorMessage,
} from "./error-message";

/* 이 문구들은 사용자가 다음에 무엇을 할지 정하는 근거다 — 틀리면 멀쩡한 데이터를 지우거나
   안 되는 일을 계속 재시도하게 만든다. 실제로 프로덕션에서 400 에 "네트워크가 느린 것
   같아요. 저장됐을 수도 있으니…" 가 떴다(셋 다 거짓이었다). 그래서 개별 문구뿐 아니라
   **원칙 자체**("확인 안 된 것은 말하지 않는다")를 전수로 검사한다. */

const trpc = (code: string) => ({ data: { code } });
const timeout = () => Object.assign(new Error("timed out"), { name: "TimeoutError" });
const aborted = () => Object.assign(new Error("aborted"), { name: "AbortError" });
// tRPC 는 원인을 감싸 던진다 — 최상위 name 만 보면 못 잡는다.
const wrapped = (inner: unknown) => Object.assign(new Error("TRPCClientError"), { cause: inner });

/* 서버가 이 코드를 줬다면 요청이 서버에 닿았다는 뜻이다 — 네트워크를 원인으로 지목할 근거가
   없다. 앞으로 코드를 추가해도 이 규칙은 깨지면 안 되므로 목록으로 훑는다. */
const SERVER_ANSWERED = [
  "BAD_REQUEST",
  "CONFLICT",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PRECONDITION_FAILED",
  "INTERNAL_SERVER_ERROR",
  "TOO_MANY_REQUESTS",
  "SOME_FUTURE_CODE",
];

describe("isAborted", () => {
  it("AbortSignal.timeout 은 AbortError 가 아니라 TimeoutError 로 끊는다 — 둘 다 잡는다", () => {
    expect(isAborted(timeout())).toBe(true);
    expect(isAborted(aborted())).toBe(true);
  });

  it("tRPC 가 감싸 던져도 cause 체인을 끝까지 훑어 찾는다", () => {
    expect(isAborted(wrapped(wrapped(timeout())))).toBe(true);
  });

  it("중단이 아닌 에러는 false", () => {
    expect(isAborted(new Error("boom"))).toBe(false);
    expect(isAborted(trpc("BAD_REQUEST"))).toBe(false);
    expect(isAborted(null)).toBe(false);
  });
});

describe("writeErrorMessage — 확인 안 된 것은 말하지 않는다", () => {
  it.each(SERVER_ANSWERED)("%s: 서버가 답했으므로 네트워크를 원인으로 지목하지 않는다", (code) => {
    expect(writeErrorMessage(trpc(code))).not.toContain("네트워크");
  });

  /* 쓰기 전에 거절된 게 확실한 코드들. "저장됐을 수도 있으니 확인하라"고 하면 없는 불안을
     만들고, 사용자가 새로고침해도 아무것도 없어 혼란만 남는다. */
  it.each(["BAD_REQUEST", "CONFLICT", "NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"])(
    "%s: 저장 여부를 애매하게 말하지 않는다",
    (code) => {
      expect(writeErrorMessage(trpc(code))).not.toContain("저장됐을 수도");
    },
  );

  it("BAD_REQUEST 는 우리 결함이라 재시도를 권하지 않는다 — 재시도로는 안 풀린다", () => {
    const msg = writeErrorMessage(trpc("BAD_REQUEST"));
    expect(msg).toContain("저장되지 않았어요");
    expect(msg).not.toContain("다시 시도");
  });

  it("CONFLICT·NOT_FOUND·인가는 무엇이 문제인지 그대로 말한다", () => {
    expect(writeErrorMessage(trpc("CONFLICT"))).toContain("이미 보드에 있는");
    expect(writeErrorMessage(trpc("NOT_FOUND"))).toContain("보드에 없는");
    expect(writeErrorMessage(trpc("FORBIDDEN"))).toContain("로그인");
  });

  /* 응답을 못 들었을 때만 "저장됐을 수도 있다"가 참이다. 그리고 우리가 아는 건 "오래 걸렸다"
     뿐이라 네트워크를 단정하지 않는다. */
  it("상한에 걸리면 저장 여부를 모른다고 말하고 확인 방법을 준다", () => {
    const msg = writeErrorMessage(wrapped(timeout()));
    expect(msg).toContain("저장됐을 수도");
    expect(msg).toContain("새로고침");
    expect(msg).not.toContain("네트워크");
  });

  /* isAborted 가 중단을 못 알아보거나 연결이 끊긴 경우. 모를 때의 기본값이 "모른다"여야
     정직함이 isAborted 의 정확성에 매달리지 않는다. */
  it("코드도 없고 중단도 아니면 원인을 말하지 않고 확인 방법만 준다", () => {
    const msg = writeErrorMessage(new Error("네트워크 연결 끊김"));
    expect(msg).toContain("확인하지 못했어요");
    expect(msg).toContain("새로고침");
    expect(msg).not.toContain("네트워크");
  });

  it("INTERNAL_SERVER_ERROR 는 어느 단계에서 죽었는지 모르므로 저장을 단정하지 않는다", () => {
    const msg = writeErrorMessage(trpc("INTERNAL_SERVER_ERROR"));
    expect(msg).toContain("확인하지 못했어요");
    expect(msg).not.toContain("저장되지 않았");
  });
});

/* 수정 경로의 CONFLICT 는 **뜻이 다르다.** add 는 category_id UNIQUE("이미 보드에 있는 게임"),
   update 는 폼이 읽은 플레이 날짜가 낡았다는 신호다. 한 문구로 뭉치면 남의 일정 변경을 덮지
   않으려고 막은 저장에 "이미 보드에 있는 게임이에요"가 떠, 사용자가 원인도 못 알아보고 할 일
   (새로고침)도 못 듣는다 — 새 서버 오류를 더하면서 클라이언트 매퍼를 안 본 자리다(리뷰 7라운드). */
describe("updateErrorMessage — 수정의 CONFLICT 는 중복이 아니라 낡은 날짜다", () => {
  it("CONFLICT 에 중복 게임 문구를 쓰지 않고, 새로고침을 안내한다", () => {
    const msg = updateErrorMessage(trpc("CONFLICT"));
    expect(msg).not.toContain("이미 보드에 있는");
    expect(msg).toContain("새로고침");
    // 서버가 쓰기 전에 막았으므로 저장 여부를 단정할 수 있다 — "저장됐을 수도"는 거짓말이다.
    expect(msg).toContain("저장하지 않았어요");
    expect(msg).not.toContain("저장됐을 수도");
  });

  /* CONFLICT 말고는 저장 어휘가 그대로 맞다 — 조작 명사가 같아서(둘 다 저장한다) 문구를 다시
     쓸 이유가 없다. 갈라진 건 그 한 갈래뿐임을 못박는다. */
  it("나머지 코드는 writeErrorMessage 와 같은 문구다", () => {
    for (const code of ["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED", "BAD_REQUEST"] as const) {
      expect(updateErrorMessage(trpc(code))).toBe(writeErrorMessage(trpc(code)));
    }
    expect(updateErrorMessage(wrapped(timeout()))).toBe(writeErrorMessage(wrapped(timeout())));
  });
});

/* 삭제는 ADR-0020 전까지 이 파일에 닿은 적이 없었다(실패가 자국 안 announcement 로만 흘렀다).
   즉시 커밋으로 바뀌며 writeErrorMessage 를 그대로 재사용했는데, 그 문구는 전부 저장 기준이라
   "삭제됐을 수도 있으니"가 참인 자리에 "저장됐을 수도 있으니"가 떴다 — 사용자가 다음에 무엇을
   할지 정하는 문장에서 조작 자체가 뒤바뀐 것이다. 위 writeErrorMessage 블록이 저장 어휘를
   **정답으로** 못박고 있어 게이트가 이걸 결함으로 읽을 수 없었으므로, 삭제판도 같은 수준으로
   전수 검사한다(readErrorMessage 가 "저장"을 훑는 것과 같은 규칙). */
describe("deleteErrorMessage — 삭제는 저장이 아니다", () => {
  it.each(SERVER_ANSWERED)("%s: 삭제 문구에 저장 어휘가 섞이지 않는다", (code) => {
    expect(deleteErrorMessage(trpc(code))).not.toContain("저장");
  });

  it("중단·연결 실패도 저장 어휘를 쓰지 않는다", () => {
    expect(deleteErrorMessage(wrapped(timeout()))).not.toContain("저장");
    expect(deleteErrorMessage(new Error("연결 끊김"))).not.toContain("저장");
  });

  it.each(SERVER_ANSWERED)("%s: 서버가 답했으므로 네트워크를 원인으로 지목하지 않는다", (code) => {
    expect(deleteErrorMessage(trpc(code))).not.toContain("네트워크");
  });

  it("상한에 걸리면 삭제 여부를 모른다고 말하고 확인 방법을 준다", () => {
    const msg = deleteErrorMessage(wrapped(timeout()));
    expect(msg).toContain("삭제됐을 수도");
    expect(msg).toContain("새로고침");
  });

  it("INTERNAL_SERVER_ERROR·연결 실패는 어느 단계에서 죽었는지 모르므로 단정하지 않는다", () => {
    for (const e of [trpc("INTERNAL_SERVER_ERROR"), new Error("연결 끊김")]) {
      const msg = deleteErrorMessage(e);
      expect(msg).toContain("삭제됐는지 확인하지 못했어요");
      expect(msg).toContain("새로고침");
    }
  });

  /* remove 는 CONFLICT 를 못 내고, 없는 id 는 오류가 아니라 deleted:false 성공이라 NOT_FOUND 도
     안 온다 — 도달 불가한 코드에 전용 문구를 두면 거짓말을 유지보수하게 된다. 남은 갈래는
     "쓰기 전에 거절됨" 하나로 모은다. */
  it("삭제에 도달 불가한 코드에 추가 문구를 만들지 않는다", () => {
    expect(deleteErrorMessage(trpc("CONFLICT"))).toBe(
      "삭제하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(deleteErrorMessage(trpc("NOT_FOUND"))).toBe(
      "삭제하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("인가 실패는 쓰기와 같은 문구를 쓴다 — 할 일이 같다", () => {
    expect(deleteErrorMessage(trpc("FORBIDDEN"))).toBe(writeErrorMessage(trpc("FORBIDDEN")));
    expect(deleteErrorMessage(trpc("UNAUTHORIZED"))).toBe(writeErrorMessage(trpc("UNAUTHORIZED")));
  });
});

describe("readErrorMessage", () => {
  it.each(SERVER_ANSWERED)("%s: 서버가 답했으므로 네트워크를 원인으로 지목하지 않는다", (code) => {
    expect(readErrorMessage(trpc(code))).not.toContain("네트워크");
  });

  it("읽기는 저장 여부가 없어 애매하게 말할 일이 없다", () => {
    for (const code of SERVER_ANSWERED) {
      expect(readErrorMessage(trpc(code))).not.toContain("저장");
    }
  });

  it("치지직 자격증명 부재(PRECONDITION_FAILED)는 사용자가 못 푸는 일이라 그렇게 말한다", () => {
    expect(readErrorMessage(trpc("PRECONDITION_FAILED"))).toContain(
      "지금은 게임 검색을 쓸 수 없어요",
    );
  });

  it("인가 실패는 읽기·쓰기가 같은 문구를 쓴다 — 할 일이 같다", () => {
    expect(readErrorMessage(trpc("UNAUTHORIZED"))).toBe(writeErrorMessage(trpc("UNAUTHORIZED")));
  });

  it("상한에 걸리면 검색이 멈췄다고 말한다", () => {
    expect(readErrorMessage(wrapped(timeout()))).toContain("오래 걸려서 멈췄어요");
  });
});
