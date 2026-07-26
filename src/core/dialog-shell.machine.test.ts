import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import { dialogShellMachine } from "./dialog-shell.machine";

function requestClose(busy: boolean, dirty: boolean, covered: boolean) {
  return { type: "REQUEST_CLOSE" as const, busy, dirty, covered };
}

function start() {
  const actor = createActor(dialogShellMachine);
  actor.start();
  return actor;
}

describe("dialogShellMachine — open 에서의 REQUEST_CLOSE 게이트", () => {
  it("open 으로 시작한다", () => {
    expect(start().getSnapshot().value).toBe("open");
  });

  it("셋 다 아니면 closing 으로 간다", () => {
    const actor = start();
    actor.send(requestClose(false, false, false));
    expect(actor.getSnapshot().value).toBe("closing");
  });

  it("busy 면 무시한다 — dirty 여도 확인을 안 띄운다(busy 가 이긴다)", () => {
    const actor = start();
    actor.send(requestClose(true, true, false));
    expect(actor.getSnapshot().value).toBe("open");
  });

  it("covered 면 무시한다 — 위에 겹친 모달이 있으니 이 뒤로가기는 유예다", () => {
    const actor = start();
    actor.send(requestClose(false, false, true));
    expect(actor.getSnapshot().value).toBe("open");
  });

  it("dirty 만 참이면 confirmingDiscard 로 간다", () => {
    const actor = start();
    actor.send(requestClose(false, true, false));
    expect(actor.getSnapshot().value).toBe("confirmingDiscard");
  });
});

describe("dialogShellMachine — confirmingDiscard 의 계속 작성 / 닫기", () => {
  it("KEEP 은 open 으로 되돌린다(입력을 그대로 둔 채)", () => {
    const actor = start();
    actor.send(requestClose(false, true, false));
    actor.send({ type: "KEEP" });
    expect(actor.getSnapshot().value).toBe("open");
  });

  it("DISCARD 는 closing 으로 간다", () => {
    const actor = start();
    actor.send(requestClose(false, true, false));
    actor.send({ type: "DISCARD" });
    expect(actor.getSnapshot().value).toBe("closing");
  });

  // confirmingDiscard 가 뜬 채 다시 REQUEST_CLOSE 가 와도(폼이 inert 라 실제로는 안 오지만)
  // 이 상태엔 그 핸들러가 없다 — 조용히 무시되어 확인이 유지된다.
  it("confirmingDiscard 중 REQUEST_CLOSE 는 무시된다", () => {
    const actor = start();
    actor.send(requestClose(false, true, false));
    actor.send(requestClose(false, false, false));
    expect(actor.getSnapshot().value).toBe("confirmingDiscard");
  });
});

describe("dialogShellMachine — closing 은 final 이 아니다", () => {
  it("closing 뒤에도 액터가 살아 있다(멈추지 않는다)", () => {
    const actor = start();
    actor.send(requestClose(false, false, false));
    expect(actor.getSnapshot().status).toBe("active");
    expect(actor.getSnapshot().value).toBe("closing");
  });
});
