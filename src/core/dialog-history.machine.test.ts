import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import { dialogHistoryMachine } from "./dialog-history.machine";

function start() {
  const actor = createActor(dialogHistoryMachine);
  const pushes: number[] = [];
  const goBacks: number[] = [];
  actor.on("pushEntry", (e) => pushes.push(e.token));
  actor.on("goBack", () => goBacks.push(1));
  actor.start();
  return { actor, pushes, goBacks };
}

/* `askOwner` 에 진짜 actor.ts 처럼 답한다 — owner() 를 흉내 낸 함수 하나로 accepted/rejected 를
   고른다. 실제 actor.ts 도 이 왕복(emit → send)을 그대로 쓴다(dialog-history.machine.ts 주석). */
function answerOwnerWith(actor: ReturnType<typeof start>["actor"], accept: () => boolean) {
  actor.on("askOwner", () => {
    actor.send({ type: accept() ? "OWNER_ACCEPTED" : "OWNER_REJECTED" });
  });
}

describe("dialogHistoryMachine — none/live 기본 청구", () => {
  it("none 으로 시작하고 hasOwner=false·token=0 이다", () => {
    const { actor } = start();
    expect(actor.getSnapshot().value).toBe("none");
    expect(actor.getSnapshot().context).toEqual({ hasOwner: false, token: 0 });
  });

  it("none 에서 CLAIM 하면 live 로 가고 pushEntry 를 낸다 — atOurEntry 와 무관하다", () => {
    const { actor, pushes } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    expect(actor.getSnapshot().value).toBe("live");
    expect(actor.getSnapshot().context).toEqual({ hasOwner: true, token: 1 });
    expect(pushes).toEqual([1]);
  });

  it("live 에서 atOurEntry=true 로 재청구하면(StrictMode 이중 셋업) 다시 안 쌓는다", () => {
    const { actor, pushes } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "CLAIM", atOurEntry: true });
    expect(actor.getSnapshot().value).toBe("live");
    expect(actor.getSnapshot().context).toEqual({ hasOwner: true, token: 1 });
    expect(pushes).toEqual([1]); // 두 번째 청구는 push 를 안 낸다.
  });

  it("live 에서 atOurEntry=false 로 재청구하면(다른 엔트리) 새로 쌓는다", () => {
    const { actor, pushes } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "CLAIM", atOurEntry: false });
    expect(actor.getSnapshot().context).toEqual({ hasOwner: true, token: 2 });
    expect(pushes).toEqual([1, 2]);
  });
});

describe("dialogHistoryMachine — ABANDON 뒤 버려진 엔트리를 물려받지 않는다(ENTRY_MARK 계약)", () => {
  // 적대적 리뷰가 잡은 자리(옛 dialog-history.ts 주석) — CLAIM → ABANDON(주인만 놓인다,
  // 엔트리는 live 로 남는다) → 돌아와 다시 CLAIM(atOurEntry=false, 이미 딴 데로 이동해 있다)
  // 하면 **새 엔트리를 쌓아야** 한다. 안 쌓으면 뒤로가기가 페이지를 떠나는데 컨트롤러는 그걸
  // 자기 엔트리로 알고 모달을 닫는다.
  it("CLAIM → ABANDON → CLAIM(atOurEntry=false) 는 두 번째 pushEntry 를 낸다", () => {
    const { actor, pushes } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    expect(pushes).toEqual([1]);

    actor.send({ type: "ABANDON" });
    expect(actor.getSnapshot().value).toBe("live");
    expect(actor.getSnapshot().context.hasOwner).toBe(false);

    actor.send({ type: "CLAIM", atOurEntry: false });
    expect(pushes).toEqual([1, 2]);
    expect(actor.getSnapshot().context).toEqual({ hasOwner: true, token: 2 });
  });
});

describe("dialogHistoryMachine — RELEASE 뒤 popping", () => {
  it("live 에서 RELEASE 하면 popping 으로 가고 goBack 을 낸다", () => {
    const { actor, goBacks } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "RELEASE" });
    expect(actor.getSnapshot().value).toBe("popping");
    expect(actor.getSnapshot().context.hasOwner).toBe(false);
    expect(goBacks).toEqual([1]);
  });

  it("popping 중 아무도 안 쌓으면 POP 도착 시 none 으로 간다(엔트리가 안 는다)", () => {
    const { actor, pushes } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "RELEASE" });
    actor.send({ type: "POP" });
    expect(actor.getSnapshot().value).toBe("none");
    expect(pushes).toEqual([1]); // popping 동안 재청구가 없었으니 추가 push 는 없다.
  });

  // 저사양 폰(20배 스로틀)에서 실측한 0~90ms 창 — back() 이 비동기 왕복인 사이 새 다이얼로그가
  // 청구하면, 도착한 POP 이 걷어낸 자리에 도로 한 칸 쌓아 그 새 소유자에게 넘겨야 한다.
  it("popping 중 새 CLAIM 이 오면 POP 도착 시 새 엔트리를 쌓고 live 로 돌아간다", () => {
    const { actor, pushes, goBacks } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "RELEASE" });
    expect(goBacks).toEqual([1]);

    actor.send({ type: "CLAIM", atOurEntry: false }); // 새 다이얼로그가 왕복 중에 청구했다.
    expect(actor.getSnapshot().value).toBe("popping"); // 아직 쌓지 않는다 — 도착한 POP 이 쌓는다.
    expect(pushes).toEqual([1]);

    actor.send({ type: "POP" }); // 우리가 부른 back() 이 이제야 도착했다.
    expect(actor.getSnapshot().value).toBe("live");
    expect(actor.getSnapshot().context).toEqual({ hasOwner: true, token: 2 });
    expect(pushes).toEqual([1, 2]);
  });

  it("popping 중 새 CLAIM 뒤 ABANDON 되면(주인이 다시 사라지면) POP 도착 시 none 이다", () => {
    const { actor, pushes } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "RELEASE" });
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "ABANDON" });
    actor.send({ type: "POP" });
    expect(actor.getSnapshot().value).toBe("none");
    expect(pushes).toEqual([1]);
  });
});

describe("dialogHistoryMachine — live 에서 POP(사용자의 진짜 뒤로가기)", () => {
  it("소유자가 없으면(버려진 엔트리) push 없이 조용히 none 으로 내린다", () => {
    const { actor, pushes } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "ABANDON" }); // 소유자가 없다 — live 이지만 hasOwner=false.
    actor.send({ type: "POP" });
    expect(actor.getSnapshot().value).toBe("none");
    // atOurEntry 를 안 물어도(이 이벤트엔 실을 값도 없다) 결과가 갈리지 않는다 — 옛 코드의
    // 두 분기(버려졌고 안 우리 엔트리 / 버려졌고 우리 엔트리)가 전부 push 없이 none 으로 갔다.
    expect(pushes).toEqual([1]); // CLAIM 때의 push 뿐, POP 이 추가로 안 쌓는다.
  });

  it("소유자가 있으면 askOwner 를 emit 하고 답을 기다린다(checkingOwner)", () => {
    const { actor } = start();
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "POP" });
    // actor.ts 가 답하기 전엔 여기 머문다 — 응답을 안 보내면 다음 CLAIM 이 씹힌다는 계약을
    // 이 상태가 지킨다(파일 상단 주석).
    expect(actor.getSnapshot().value).toBe("checkingOwner");
    expect(actor.getSnapshot().context.hasOwner).toBe(false);
  });

  it("소유자가 닫기를 받아들이면(OWNER_ACCEPTED) none 으로 간다 — 재푸시 없다", () => {
    const { actor, pushes } = start();
    answerOwnerWith(actor, () => true);
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "POP" });
    expect(actor.getSnapshot().value).toBe("none");
    expect(actor.getSnapshot().context.hasOwner).toBe(false);
    expect(pushes).toEqual([1]);
  });

  it("소유자가 거절하면(OWNER_REJECTED — busy·covered·dirty) 엔트리를 다시 쌓고 live 로 돌아간다", () => {
    const { actor, pushes } = start();
    answerOwnerWith(actor, () => false);
    actor.send({ type: "CLAIM", atOurEntry: false });
    actor.send({ type: "POP" });
    expect(actor.getSnapshot().value).toBe("live");
    expect(actor.getSnapshot().context).toEqual({ hasOwner: true, token: 2 });
    expect(pushes).toEqual([1, 2]);
  });
});
