import { createActor, waitFor } from "xstate";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS } from "./error-message";
import { createSubmitMachine } from "./submit.machine";

// run 은 (values, signal) => Promise 를 흉내 낸다. resolve/reject 를 밖에서 쥐고 원할 때 정착시킨다.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function start<TValues, TResult>(
  run: (values: TValues, signal: AbortSignal) => Promise<TResult>,
  mapError: (e: unknown) => string = String,
) {
  const machine = createSubmitMachine<TValues, TResult>();
  const actor = createActor(machine, { input: { run, mapError } });
  actor.start();
  return actor;
}

describe("submitMachine", () => {
  it("idle 로 시작하고 error·result 가 비어 있다", () => {
    const actor = start<number, string>(async (v) => String(v));
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.error).toBe("");
    expect(actor.getSnapshot().context.result).toBeUndefined();
  });

  it("submit 이 오면 곧바로(비동기 정착 전에) submitting 으로 간다", () => {
    const { promise } = deferred<string>();
    const actor = start<number, string>(async () => promise);
    actor.send({ type: "submit", values: 1 });
    expect(actor.getSnapshot().value).toBe("submitting");
  });

  it("성공하면 done 으로 가고 context.result 가 run 의 반환값이다", async () => {
    const actor = start<number, string>(async (v) => "ok:" + v);
    actor.send({ type: "submit", values: 7 });
    await waitFor(actor, (s) => s.matches("done"));
    expect(actor.getSnapshot().context.result).toBe("ok:7");
    expect(actor.getSnapshot().context.error).toBe("");
  });

  it("실패하면 idle 로 되돌아가고 context.error 가 mapError 의 결과다", async () => {
    const actor = start<number, string>(
      async () => {
        throw new Error("boom");
      },
      () => "사람이 읽을 실패 문구",
    );
    actor.send({ type: "submit", values: 1 });
    await waitFor(actor, (s) => s.matches("idle") && s.context.error !== "");
    expect(actor.getSnapshot().context.error).toBe("사람이 읽을 실패 문구");
    expect(actor.getSnapshot().context.result).toBeUndefined();
  });

  it("다음 submit 이 이전 실패 문구를 지운다", async () => {
    let attempt = 0;
    const actor = start<number, string>(
      async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("first fails");
        return "second ok";
      },
      () => "실패",
    );
    actor.send({ type: "submit", values: 1 });
    await waitFor(actor, (s) => s.context.error !== "");

    actor.send({ type: "submit", values: 2 });
    // 재제출 즉시(정착 전) 이전 에러가 지워져야 한다 — 안 지우면 새 시도 중에 옛 실패 문구가 남는다.
    expect(actor.getSnapshot().context.error).toBe("");

    await waitFor(actor, (s) => s.matches("done"));
    expect(actor.getSnapshot().context.result).toBe("second ok");
  });

  /* suggestion-inbox 처럼 한 인스턴스가 여러 항목을 순서대로 제출하는 호출자를 위한 계약 —
     done 은 final 이 아니라서 성공 뒤에도 다시 submit 을 받는다(submit.machine.ts 주석 참고). */
  it("done 에서도 다시 submit 을 받아 재사용된다", async () => {
    const actor = start<number, string>(async (v) => "r" + v);
    actor.send({ type: "submit", values: 1 });
    await waitFor(actor, (s) => s.matches("done"));
    expect(actor.getSnapshot().context.result).toBe("r1");

    actor.send({ type: "submit", values: 2 });
    expect(actor.getSnapshot().value).toBe("submitting");
    await waitFor(actor, (s) => s.matches("done"));
    expect(actor.getSnapshot().context.result).toBe("r2");
  });

  /* 적대적 리뷰가 잡은 자리 — done 을 재사용하는 호출자(suggestion-inbox)가 첫 성공 뒤 다음
     제출에서 실패하면, context.result 가 옛 성공값을 그대로 들고 있어선 안 된다. s.matches("done")
     검사를 빼먹은 자리에서 그 값을 "지금 제출의 결과"로 오독하게 되기 때문이다. */
  it("done 뒤 다음 제출이 실패하면 이전 성공의 result 가 남지 않는다", async () => {
    let attempt = 0;
    const actor = start<number, string>(
      async (v) => {
        attempt += 1;
        if (attempt === 1) return "first ok";
        throw new Error("second fails");
      },
      () => "실패",
    );
    actor.send({ type: "submit", values: 1 });
    await waitFor(actor, (s) => s.matches("done"));
    expect(actor.getSnapshot().context.result).toBe("first ok");

    actor.send({ type: "submit", values: 2 });
    // 실패로 정착하기 전, submitting 진입 시점에 이미 지워져 있어야 한다.
    expect(actor.getSnapshot().context.result).toBeUndefined();

    await waitFor(actor, (s) => s.matches("idle") && s.context.error !== "");
    expect(actor.getSnapshot().context.result).toBeUndefined();
    expect(actor.getSnapshot().context.error).toBe("실패");
  });

  it("run 이 받는 signal 은 REQUEST_TIMEOUT_MS 로 만든 AbortSignal 이다 — 호출자가 만들지 않는다", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    let seenSignal: AbortSignal | undefined;
    const actor = start<undefined, null>(async (_v, signal) => {
      seenSignal = signal;
      return null;
    });
    actor.send({ type: "submit", values: undefined });
    await waitFor(actor, (s) => s.matches("done"));
    expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });

  it("submit 의 values 가 run 에 그대로 전달된다", async () => {
    const received: unknown[] = [];
    const actor = start<{ id: number }, void>(async (v) => {
      received.push(v);
    });
    actor.send({ type: "submit", values: { id: 42 } });
    await waitFor(actor, (s) => s.matches("done"));
    expect(received).toEqual([{ id: 42 }]);
  });
});

describe("submitMachine — 정착 전 재제출 방어", () => {
  /* submitting 은 idle/done 과 달리 submit 을 안 받는다 — 폼이 busy 동안 제출 버튼을 잠그므로
     실제로 도달하지 않는 경로지만, 그 잠금이 유일한 방어선이 되면 안 된다는 걸 여기서 못박는다. */
  it("submitting 상태에선 submit 이벤트를 무시한다", async () => {
    const { promise, resolve } = deferred<string>();
    const runs: number[] = [];
    const actor = start<number, string>(async (v) => {
      runs.push(v);
      return promise;
    });
    actor.send({ type: "submit", values: 1 });
    expect(actor.getSnapshot().value).toBe("submitting");
    actor.send({ type: "submit", values: 2 });
    resolve("done");
    await waitFor(actor, (s) => s.matches("done"));
    expect(runs).toEqual([1]);
    expect(actor.getSnapshot().context.result).toBe("done");
  });
});
