import { createActor, waitFor } from "xstate";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS } from "./error-message";
import { playDatesLoadMachine } from "./play-dates-load.machine";

function start(run: (signal: AbortSignal) => Promise<string[]>) {
  const actor = createActor(playDatesLoadMachine, { input: { run } });
  actor.start();
  return actor;
}

describe("playDatesLoadMachine", () => {
  it("loading 으로 시작하고 dates 가 비어 있다", () => {
    const actor = start(() => new Promise(() => {}));
    expect(actor.getSnapshot().value).toBe("loading");
    expect(actor.getSnapshot().context.dates).toEqual([]);
  });

  it("조회가 성공하면 loaded 로 가고 context.dates 가 채워진다", async () => {
    const actor = start(async () => ["2026-07-01"]);
    await waitFor(actor, (s) => s.matches("loaded"));
    expect(actor.getSnapshot().context.dates).toEqual(["2026-07-01"]);
  });

  it("여러 날 편성이면 dates 배열이 그대로 여러 개다", async () => {
    const actor = start(async () => ["2026-07-01", "2026-07-08"]);
    await waitFor(actor, (s) => s.matches("loaded"));
    expect(actor.getSnapshot().context.dates).toEqual(["2026-07-01", "2026-07-08"]);
  });

  it("조회가 실패하면 failed 로 가고 dates 는 비어 있다", async () => {
    const actor = start(async () => {
      throw new Error("network");
    });
    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.dates).toEqual([]);
  });

  it("failed 는 재시도 이벤트를 안 받는다 — 실패는 되돌릴 방법이 없다", async () => {
    const actor = start(async () => {
      throw new Error("network");
    });
    await waitFor(actor, (s) => s.matches("failed"));
    // 어떤 이벤트를 보내도(정의된 이벤트가 없으므로) 그대로 failed 다.
    actor.send({ type: "retry" } as never);
    expect(actor.getSnapshot().value).toBe("failed");
  });

  it("run 이 받는 signal 은 REQUEST_TIMEOUT_MS 로 만든 AbortSignal 이다 — 호출자가 만들지 않는다", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    let seenSignal: AbortSignal | undefined;
    const actor = start(async (signal) => {
      seenSignal = signal;
      return [];
    });
    await waitFor(actor, (s) => s.matches("loaded"));
    expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });
});
