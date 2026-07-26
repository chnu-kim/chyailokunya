import { createActor, waitFor } from "xstate";
import { describe, expect, it } from "vitest";
import { makeDraftEntry, type WeekDraft } from "./schedule-editor";
import {
  scheduleSaveMachine,
  type SaveWeekResult,
  type SaveWeekValues,
} from "./schedule-save.machine";

/* schedule-save 머신 — 이슈 #85. submit.machine.test.ts 와 같은 결(createActor + waitFor +
   deferred)로 잰다. 핵심은 CAS(revision) 계약과, submit 자식의 성공/실패를 `onSnapshot` 이
   정확히 부모에게 되돌리는가다. */

function draft(over: Partial<WeekDraft> = {}): WeekDraft {
  return { note: "", published: false, entries: [], ...over };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function start(opts: {
  run: (values: SaveWeekValues, signal: AbortSignal) => Promise<SaveWeekResult>;
  mapError?: (e: unknown) => string;
  initialDraft?: WeekDraft;
  initialRevision?: number | null;
}) {
  const actor = createActor(scheduleSaveMachine, {
    input: {
      weekStartDate: "2027-01-04",
      initialDraft: opts.initialDraft ?? draft(),
      initialRevision: opts.initialRevision ?? null,
      run: opts.run,
      mapError: opts.mapError ?? (() => "실패 문구"),
    },
  });
  actor.start();
  return actor;
}

describe("scheduleSaveMachine — 초기 상태", () => {
  it("ready 로 시작하고 context 가 input 그대로다", () => {
    const initialDraft = draft({ note: "공지" });
    const actor = start({
      run: async () => ({ draft: initialDraft, revision: 1 }),
      initialDraft,
      initialRevision: 5,
    });
    const s = actor.getSnapshot();
    expect(s.value).toBe("ready");
    expect(s.context.draft).toBe(initialDraft);
    expect(s.context.baseline).toBe(initialDraft);
    expect(s.context.revision).toBe(5);
    expect(s.context.error).toBe("");
    expect(s.context.announcement).toBe("");
  });
});

describe("scheduleSaveMachine — 편집 이벤트(순수 전이의 얇은 배선)", () => {
  it("NOTE_CHANGED·PUBLISHED_CHANGED 는 draft 의 그 필드만 바꾼다", () => {
    const actor = start({ run: async () => ({ draft: draft(), revision: null }) });
    actor.send({ type: "NOTE_CHANGED", note: "이번 주는 젤다" });
    expect(actor.getSnapshot().context.draft.note).toBe("이번 주는 젤다");
    actor.send({ type: "PUBLISHED_CHANGED", published: true });
    expect(actor.getSnapshot().context.draft.published).toBe(true);
  });

  it("ENTRY_ADDED 는 new-{seq} 키로 더하고 seq 를 증가시킨다 — 같은 날 두 번 더해도 키가 겹치지 않는다", () => {
    const actor = start({ run: async () => ({ draft: draft(), revision: null }) });
    actor.send({ type: "ENTRY_ADDED", date: "2027-01-04" });
    actor.send({ type: "ENTRY_ADDED", date: "2027-01-05" });
    const entries = actor.getSnapshot().context.draft.entries;
    expect(entries.map((e) => e.key)).toEqual(["new-0", "new-1"]);
    expect(entries.map((e) => e.scheduledDate)).toEqual(["2027-01-04", "2027-01-05"]);
  });

  it("ENTRY_REMOVED·ENTRY_PATCHED 는 그 키만 건드린다", () => {
    const seeded = draft({
      entries: [makeDraftEntry("a", "2027-01-04"), makeDraftEntry("b", "2027-01-05")],
    });
    const actor = start({
      run: async () => ({ draft: draft(), revision: null }),
      initialDraft: seeded,
    });
    actor.send({ type: "ENTRY_PATCHED", key: "b", patch: { title: "저챗" } });
    expect(actor.getSnapshot().context.draft.entries.find((e) => e.key === "b")?.title).toBe(
      "저챗",
    );
    actor.send({ type: "ENTRY_REMOVED", key: "a" });
    expect(actor.getSnapshot().context.draft.entries.map((e) => e.key)).toEqual(["b"]);
  });
});

describe("scheduleSaveMachine — SAVE 계약", () => {
  it("run 이 받는 payload 가 CAS 계약 그대로다(weekStartDate·revision·note·published·entries)", async () => {
    const seeded = draft({
      note: "  공지  ",
      published: true,
      entries: [makeDraftEntry("a", "2027-01-04")],
    });
    seeded.entries[0]!.title = "젤다";
    let seen: SaveWeekValues | undefined;
    const actor = start({
      run: async (values) => {
        seen = values;
        return { draft: values as unknown as WeekDraft, revision: 1 };
      },
      initialDraft: seeded,
      initialRevision: 9,
    });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    expect(seen).toEqual({
      weekStartDate: "2027-01-04",
      revision: 9,
      // note 는 trim 하지 않는다 — 그 정규화의 정본은 서버 saveWeekInput(Zod) 하나다(schedule-editor.tsx
      // 의 원본 onSave 와 같다).
      note: "  공지  ",
      published: true,
      entries: [{ scheduledDate: "2027-01-04", startTime: null, title: "젤다", gameId: null }],
    });
  });

  it("SAVE 는 곧바로(정착 전) saving 으로 간다 — 저장 중엔 재제출을 무시한다", () => {
    const { promise } = deferred<SaveWeekResult>();
    const runs: SaveWeekValues[] = [];
    const actor = start({
      run: async (values) => {
        runs.push(values);
        return promise;
      },
    });
    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("saving");
    // 저장 중 다시 눌러도(버튼 disabled 가 유일한 방어선이 아니다) 두 번째 run 이 안 나간다.
    actor.send({ type: "SAVE" });
    expect(runs).toHaveLength(1);
  });

  it("성공하면 draft·baseline 을 서버 응답으로 통째로 교체하고 announcement 를 세운다(발행)", async () => {
    const saved: WeekDraft = { note: "공지", published: true, entries: [] };
    const actor = start({ run: async () => ({ draft: saved, revision: 42 }) });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 42);
    const s = actor.getSnapshot();
    expect(s.context.draft).toBe(saved);
    expect(s.context.baseline).toBe(saved);
    expect(s.context.revision).toBe(42);
    expect(s.context.error).toBe("");
    expect(s.context.announcement).toBe("일정을 저장하고 발행했습니다");
  });

  it("초안으로 저장하면 announcement 가 초안 문구다", async () => {
    const saved: WeekDraft = { note: "", published: false, entries: [] };
    const actor = start({ run: async () => ({ draft: saved, revision: 1 }) });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    expect(actor.getSnapshot().context.announcement).toBe("일정을 저장했습니다(초안)");
  });

  /* CAS 의 핵심 — submit.machine.ts 의 계약대로 dev 주석에 있는 "안 갈면 두 번째 저장이 자기
     자신과 충돌한다"를 못박는다. */
  it("성공 뒤 다음 SAVE 는 새 revision 을 싣는다(옛 revision 을 재사용하지 않는다)", async () => {
    const seen: (number | null)[] = [];
    const actor = start({
      run: async (values) => {
        seen.push(values.revision);
        return { draft: draft(), revision: values.revision === null ? 1 : values.revision + 1 };
      },
      initialRevision: null,
    });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 2);
    expect(seen).toEqual([null, 1]);
  });

  it("실패하면 error 만 세우고 draft·baseline·revision·announcement 는 그대로다(재시도가 같은 revision 으로 다시 CONFLICT 를 받게)", async () => {
    const seeded = draft({ note: "안 날아간 공지" });
    const actor = start({
      run: async () => {
        throw new Error("conflict");
      },
      mapError: () => "다른 곳에서 먼저 저장했습니다",
      initialDraft: seeded,
      initialRevision: 7,
    });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.error !== "");
    const s = actor.getSnapshot();
    expect(s.context.error).toBe("다른 곳에서 먼저 저장했습니다");
    expect(s.context.draft).toBe(seeded);
    expect(s.context.baseline).toBe(seeded);
    expect(s.context.revision).toBe(7);
    expect(s.context.announcement).toBe("");
  });

  /* 적대적 리뷰가 잡은 자리 — SAVE 는 재시도 시작 즉시(정착 전) error 를 지워야 한다. 안 지우면
     두 번째 요청이 아직 안 끝났는데도 화면이 "저장 중"과 "옛 실패 문구"를 동시에 보여준다
     (원본 onSave 의 `setError("")` 가 await 전에 먼저 도는 것과 같은 계약). */
  it("실패 뒤 재시도는 두 번째 요청이 끝나기 전에 곧바로 error 를 지운다", async () => {
    const { promise } = deferred<SaveWeekResult>();
    let attempt = 0;
    const actor = start({
      run: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("first fails");
        return promise; // 두 번째 시도는 정착하지 않는다 — "정착 전" 을 관찰하려고.
      },
      mapError: () => "실패 문구",
    });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.error !== "");
    expect(actor.getSnapshot().context.error).toBe("실패 문구");

    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("saving");
    // 아직 두 번째 run 이 정착하지 않았는데도 옛 실패 문구가 이미 지워져 있어야 한다.
    expect(actor.getSnapshot().context.error).toBe("");
  });

  it("실패는 이전 성공의 announcement 를 지우지 않는다(원본이 실패 시 announcement 를 안 건드리던 것과 같다)", async () => {
    let attempt = 0;
    const savedOnce: WeekDraft = { note: "", published: false, entries: [] };
    const actor = start({
      run: async () => {
        attempt += 1;
        if (attempt === 1) return { draft: savedOnce, revision: 1 };
        throw new Error("second fails");
      },
    });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    expect(actor.getSnapshot().context.announcement).toBe("일정을 저장했습니다(초안)");

    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.error !== "");
    expect(actor.getSnapshot().context.announcement).toBe("일정을 저장했습니다(초안)");
  });

  it("저장이 날아가는 동안 편집해도 성공하면 서버 응답이 그 편집을 덮는다(원본 계약 — 잠그지 않는 대가)", async () => {
    const { promise, resolve } = deferred<SaveWeekResult>();
    const actor = start({ run: async () => promise });
    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("saving");

    // 저장 중에도 편집 이벤트는 받는다(원본이 입력을 안 잠근다).
    actor.send({ type: "NOTE_CHANGED", note: "저장 중에 고친 공지" });
    expect(actor.getSnapshot().context.draft.note).toBe("저장 중에 고친 공지");

    const fromServer: WeekDraft = { note: "서버가 되돌린 값", published: false, entries: [] };
    resolve({ draft: fromServer, revision: 2 });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 2);
    // 저장 중 편집("저장 중에 고친 공지")은 서버 응답에 덮인다.
    expect(actor.getSnapshot().context.draft).toBe(fromServer);
  });
});
