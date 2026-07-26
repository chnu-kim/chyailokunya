import { createActor, waitFor } from "xstate";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS } from "./error-message";
import { createInboxLoadMachine } from "./inbox-load.machine";

type Item = { id: number; label: string };

function start(
  run: (signal: AbortSignal) => Promise<Item[]>,
  mapError: (e: unknown) => string = String,
) {
  const machine = createInboxLoadMachine<Item>();
  const actor = createActor(machine, { input: { run, mapError } });
  actor.start();
  return actor;
}

describe("inboxLoadMachine — 최초 조회", () => {
  it("loading 으로 시작하고 items·error 가 비어 있다", () => {
    const actor = start(() => new Promise(() => {}));
    expect(actor.getSnapshot().value).toBe("loading");
    expect(actor.getSnapshot().context.items).toEqual([]);
    expect(actor.getSnapshot().context.error).toBe("");
  });

  it("조회가 성공하면 loaded 로 가고 context.items 가 채워진다", async () => {
    const items = [{ id: 1, label: "a" }];
    const actor = start(async () => items);
    await waitFor(actor, (s) => s.matches("loaded"));
    expect(actor.getSnapshot().context.items).toEqual(items);
  });

  it("조회가 실패하면 failed 로 가고 context.error 가 mapError 의 결과다", async () => {
    const actor = start(
      async () => {
        throw new Error("network");
      },
      () => "검색에 실패했습니다.",
    );
    await waitFor(actor, (s) => s.matches("failed"));
    expect(actor.getSnapshot().context.error).toBe("검색에 실패했습니다.");
    expect(actor.getSnapshot().context.items).toEqual([]);
  });

  it("run 이 받는 signal 은 REQUEST_TIMEOUT_MS 로 만든 AbortSignal 이다", async () => {
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

describe("inboxLoadMachine — loaded 이후 갱신", () => {
  async function startLoaded(items: Item[]) {
    const actor = start(async () => items);
    await waitFor(actor, (s) => s.matches("loaded"));
    return actor;
  }

  it("itemRemoved 는 목록에서 그 항목만 뺀다", async () => {
    const actor = await startLoaded([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
    ]);
    actor.send({ type: "itemRemoved", id: 1 });
    expect(actor.getSnapshot().context.items).toEqual([{ id: 2, label: "b" }]);
  });

  it("itemsReplaced 는 items 를 통째로 갈아 끼우고 이전 오류를 지운다", async () => {
    const actor = await startLoaded([{ id: 1, label: "a" }]);
    actor.send({ type: "itemError", message: "다음 제안을 불러오지 못했습니다." });
    expect(actor.getSnapshot().context.error).not.toBe("");

    actor.send({ type: "itemsReplaced", items: [{ id: 3, label: "c" }] });
    expect(actor.getSnapshot().context.items).toEqual([{ id: 3, label: "c" }]);
    expect(actor.getSnapshot().context.error).toBe("");
  });

  it("itemError 는 error 만 세우고 items 는 그대로 둔다", async () => {
    const actor = await startLoaded([{ id: 1, label: "a" }]);
    actor.send({ type: "itemError", message: "다음 제안을 불러오지 못했습니다." });
    expect(actor.getSnapshot().context.items).toEqual([{ id: 1, label: "a" }]);
    expect(actor.getSnapshot().context.error).toBe("다음 제안을 불러오지 못했습니다.");
  });

  /* suggestion-inbox.rejecting.test.tsx 특성화 — 상한을 넘겨 동시에 거절되면 나중에 던진(더
     최신인) 재조회가 먼저 오고, 먼저 던진(더 낡은) 재조회가 그 id 를 다시 담은 채 나중에 온다.
     resolvedIds 가 그 낡은 스냅샷에서 이미 처리된 항목을 걸러내야 한다. */
  it("itemRemoved 로 처리된 id 는 그 뒤의 itemsReplaced 가 되살리지 못한다", async () => {
    const actor = await startLoaded([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
    ]);
    actor.send({ type: "itemRemoved", id: 2 });
    // 낡은 재조회 응답 — item2 가 아직 안 지워졌을 때 조회한 스냅샷이라 다시 들어 있다.
    actor.send({
      type: "itemsReplaced",
      items: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ],
    });
    expect(actor.getSnapshot().context.items).toEqual([{ id: 1, label: "a" }]);
  });

  it("itemRemoved 뒤 resolvedIds 가 누적된다 — 여러 항목이 처리돼도 전부 걸러진다", async () => {
    const actor = await startLoaded([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 3, label: "c" },
    ]);
    actor.send({ type: "itemRemoved", id: 1 });
    actor.send({ type: "itemRemoved", id: 2 });
    actor.send({
      type: "itemsReplaced",
      items: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
        { id: 3, label: "c" },
        { id: 4, label: "d" },
      ],
    });
    expect(actor.getSnapshot().context.items).toEqual([
      { id: 3, label: "c" },
      { id: 4, label: "d" },
    ]);
  });
});
