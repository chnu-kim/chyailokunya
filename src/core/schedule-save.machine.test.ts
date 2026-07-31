import { createActor, waitFor } from "xstate";
import { describe, expect, it } from "vitest";
import { makeDraftEntry, type WeekDraft } from "./schedule-editor";
import {
  scheduleSaveMachine,
  type FanartUploadResult,
  type FanartUploadValues,
  type PublishWeekResult,
  type PublishWeekValues,
  type SaveWeekResult,
  type SaveWeekValues,
} from "./schedule-save.machine";

/* schedule-save 머신 — 이슈 #85. submit.machine.test.ts 와 같은 결(createActor + waitFor +
   deferred)로 잰다. 핵심은 CAS(revision) 계약과, submit 자식의 성공/실패를 `onSnapshot` 이
   정확히 부모에게 되돌리는가다. */

function draft(over: Partial<WeekDraft> = {}): WeekDraft {
  return {
    note: "",
    published: false,
    entries: [],
    days: {},
    fanartImageKey: null,
    fanartCredit: "",
    ...over,
  };
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
  publishRun?: (values: PublishWeekValues, signal: AbortSignal) => Promise<PublishWeekResult>;
  uploadRun?: (values: FanartUploadValues, signal: AbortSignal) => Promise<FanartUploadResult>;
  mapError?: (e: unknown) => string;
  mapUploadError?: (e: unknown) => string;
  initialDraft?: WeekDraft;
  initialRevision?: number | null;
}) {
  const actor = createActor(scheduleSaveMachine, {
    input: {
      weekStartDate: "2027-01-04",
      initialDraft: opts.initialDraft ?? draft(),
      initialRevision: opts.initialRevision ?? null,
      run: opts.run,
      publishRun:
        opts.publishRun ??
        (async () => {
          throw new Error("publishRun 이 이 테스트에서 안 쓰일 것으로 예상됐다");
        }),
      uploadRun:
        opts.uploadRun ??
        (async () => {
          throw new Error("uploadRun 이 이 테스트에서 안 쓰일 것으로 예상됐다");
        }),
      mapError: opts.mapError ?? (() => "실패 문구"),
      mapUploadError: opts.mapUploadError ?? (() => "업로드 실패 문구"),
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
    expect(s.context.publishError).toBe("");
    expect(s.context.announcement).toBe("");
  });
});

describe("scheduleSaveMachine — 편집 이벤트(순수 전이의 얇은 배선)", () => {
  it("NOTE_CHANGED 는 draft 의 그 필드만 바꾼다", () => {
    const actor = start({ run: async () => ({ draft: draft(), revision: null }) });
    actor.send({ type: "NOTE_CHANGED", note: "이번 주는 젤다" });
    expect(actor.getSnapshot().context.draft.note).toBe("이번 주는 젤다");
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

  /* 결정 30 — DAY_PATCHED 는 setDay 를 그대로 배선한 것이라, 휴방을 켜는 전이에서 그날의
     빈 제목 항목이 지워지는 것도 머신 레벨에서 관찰돼야 한다(schedule-editor.test.ts 가
     순수 함수 레벨을 이미 못박았다 — 여기는 그 배선이 새지 않는지를 본다). */
  it("DAY_PATCHED 로 휴방을 켜면 그날의 빈 제목 항목이 지워진다", () => {
    const seeded = draft({
      entries: [
        makeDraftEntry("blank", "2027-01-04"), // 제목 기본값 "" — 빈 항목
        { ...makeDraftEntry("filled", "2027-01-05"), title: "젤다" },
      ],
    });
    const actor = start({
      run: async () => ({ draft: draft(), revision: null }),
      initialDraft: seeded,
    });
    actor.send({ type: "DAY_PATCHED", date: "2027-01-04", patch: { rest: true } });
    const entries = actor.getSnapshot().context.draft.entries;
    expect(entries.map((e) => e.key)).toEqual(["filled"]);
  });
});

describe("scheduleSaveMachine — SAVE 계약", () => {
  /* firstBlankTitleEntry 가드(Plan 에이전트 리뷰, 2026-07-28) — draftEntryInputs 가 빈 제목
     항목을 조용히 걸러 버리므로, 막지 않으면 저장이 "성공"하고 그 줄이 화면에서 신호 없이
     사라진다. */
  it("제목이 빈 항목이 있으면 서버로 안 나가고 요일을 짚은 에러만 세운다", () => {
    let calls = 0;
    const seeded = draft({
      entries: [
        makeDraftEntry("a", "2027-01-04"), // 월요일 — title 기본값 "" 그대로(빈 제목)
      ],
    });
    const actor = start({
      run: async () => {
        calls += 1;
        return { draft: draft(), revision: 1 };
      },
      initialDraft: seeded,
    });
    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("ready"); // saving 으로 안 간다
    expect(calls).toBe(0);
    expect(actor.getSnapshot().context.error).toContain("월요일");
    expect(actor.getSnapshot().context.error).toContain("제목이 없습니다");
  });

  /* 결정 30 — 이 테스트가 고치는 라이브 결함이다. 예전엔 빈 줄이 있는 날을 휴방으로 켜도
     firstBlankTitleEntry 가 여전히 그 항목을 걸어 SAVE 를 막았고, 오류 문구가 안내하는
     "제목을 채우거나"는 휴방이라 입력칸이 잠겨 있어 막다른 골목이었다(AGENTS "잠금은 빠져나갈
     길을 하나는 남긴다"). */
  it("빈 줄이 있는 날을 휴방으로 켜면 저장이 더는 막히지 않는다(라이브 저장 차단 해소)", async () => {
    let calls = 0;
    const seeded = draft({
      entries: [makeDraftEntry("a", "2027-01-04")], // 월요일 — 제목 기본값 "" (빈 항목)
    });
    const actor = start({
      run: async () => {
        calls += 1;
        return { draft: draft(), revision: 1 };
      },
      initialDraft: seeded,
    });
    actor.send({ type: "DAY_PATCHED", date: "2027-01-04", patch: { rest: true } });
    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("saving"); // ready 에 안 머문다 — 가드에 안 걸린다
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    expect(calls).toBe(1);
    expect(actor.getSnapshot().context.error).toBe("");
  });

  it("제목을 채우면 다시 SAVE 가 정상 진행된다", async () => {
    const actor = start({ run: async () => ({ draft: draft(), revision: 1 }) });
    actor.send({ type: "ENTRY_ADDED", date: "2027-01-04" });
    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("ready");
    expect(actor.getSnapshot().context.error).not.toBe("");

    actor.send({ type: "ENTRY_PATCHED", key: "new-0", patch: { title: "젤다" } });
    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("saving");
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    expect(actor.getSnapshot().context.error).toBe("");
  });

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
      entries: [{ scheduledDate: "2027-01-04", title: "젤다", gameId: null }],
      // 하루 속성도 같은 페이로드로 나간다(이슈 #117) — 기본값인 날은 draftDayInputs 가 접는다.
      days: [],
      /* 팬아트 둘이 **항상** 실린다(ADR-0028) — 화면은 서버의 `undefined = 유지` 규약에 기대지
         않는다(그러면 "지움"을 표현할 수 없다). 치수는 여기 없다: 업로드가 R2 객체 메타에 묶고
         저장 경로가 거기서 읽는다(ADR-0030). */
      fanartImageKey: null,
      fanartCredit: null,
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
    const saved: WeekDraft = draft({ note: "공지", published: true });
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
    const saved: WeekDraft = draft();
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
    const savedOnce: WeekDraft = draft();
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

    const fromServer: WeekDraft = draft({ note: "서버가 되돌린 값" });
    resolve({ draft: fromServer, revision: 2 });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 2);
    // 저장 중 편집("저장 중에 고친 공지")은 서버 응답에 덮인다.
    expect(actor.getSnapshot().context.draft).toBe(fromServer);
  });
});

describe("scheduleSaveMachine — 팬아트 업로드 계약(ADR-0028)", () => {
  const KEY = "0189d1f0-3a4b-7c8d-9e0f-1a2b3c4d5e6f.png";
  // 업로드 자식에 실려 가는 건 바이트 그대로다 — 형식 판정은 서버가 매직 바이트로 한다.
  const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

  it("성공하면 키·치수가 draft 에 들어가고 표기는 비워진다", async () => {
    /* **표기를 비우는 게 이 테스트의 핵심이다.** 편집기는 표기를 항상 함께 보내므로 서버의
       "키가 바뀌면 옛 표기를 안 물려준다"(nextFanart 규칙 2)가 발동하지 않는다 — 화면이 안
       지우면 옛 작가 이름이 새 그림에 붙어 **잘못된 귀속**이 그대로 저장된다. */
    const seeded = draft({
      fanartImageKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
      fanartCredit: "먼저 그린 사람",
    });
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      uploadRun: async () => ({ key: KEY }),
      initialDraft: seeded,
    });

    actor.send({ type: "FANART_UPLOAD", file });
    expect(actor.getSnapshot().value).toBe("uploading");
    await waitFor(actor, (s) => s.matches("ready"));

    const { draft: d, fanartError, announcement } = actor.getSnapshot().context;
    expect(d.fanartImageKey).toBe(KEY);
    expect(d.fanartCredit).toBe("");
    expect(fanartError).toBe("");
    // 업로드만으로는 어느 주에도 안 걸린다 — 남은 한 걸음을 글자로 말한다.
    expect(announcement).toContain("저장해야");
  });

  it("업로드 결과는 키 하나다 — 치수는 draft 를 거치지 않는다", async () => {
    /* 치수는 업로드가 R2 객체 메타에 묶고 저장 경로가 거기서 읽는다(ADR-0030) — 화면을 거치면
       그 값이 다시 클라이언트 주장이 되어 불변식 2 가 이 필드에서만 빠진다(적대적 리뷰 9라운드).
       그래서 draft·저장 페이로드 어디에도 치수가 없다. */
    let seen: SaveWeekValues | undefined;
    const actor = start({
      run: async (values) => {
        seen = values;
        return { draft: draft({ fanartImageKey: KEY }), revision: 1 };
      },
      uploadRun: async () => ({ key: KEY }),
      initialDraft: draft({
        entries: [{ ...makeDraftEntry("db-1", "2027-01-04"), title: "젤다" }],
      }),
    });
    actor.send({ type: "FANART_UPLOAD", file });
    await waitFor(actor, (s) => s.matches("ready"));
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    expect(seen).toMatchObject({ fanartImageKey: KEY });
    expect(seen).not.toHaveProperty("fanartImageWidth");
    expect(seen).not.toHaveProperty("fanartImageHeight");
  });

  it("실패는 fanartError 만 세운다 — 저장·발행 문구를 건드리지 않는다", async () => {
    /* 에러를 하나로 공유하면 화면의 다른 자리(저장 바·발행 확인창)가 업로드 실패를 자기 실패로
       보여준다. 셋으로 나눈 이유가 그것이라 여기서 못박는다. */
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      uploadRun: async () => {
        throw new Error("413");
      },
      mapUploadError: () => "파일이 너무 큽니다",
    });
    actor.send({ type: "FANART_UPLOAD", file });
    await waitFor(actor, (s) => s.matches("ready") && s.context.fanartError !== "");
    const c = actor.getSnapshot().context;
    expect(c.fanartError).toBe("파일이 너무 큽니다");
    expect(c.error).toBe("");
    expect(c.publishError).toBe("");
    // 실패했으니 draft 는 그대로다 — 키가 없는 채로 남는다.
    expect(c.draft.fanartImageKey).toBeNull();
  });

  it("업로드 중에는 SAVE 를 무시한다 — 키 없는 draft 가 저장되면 '올렸는데 안 걸렸다'가 된다", () => {
    const { promise } = deferred<FanartUploadResult>();
    let saves = 0;
    const actor = start({
      run: async () => {
        saves += 1;
        return { draft: draft(), revision: 1 };
      },
      uploadRun: () => promise,
      // 저장 가능한 상태로 둔다(dirty·제목 있음) — 무시되는 이유가 "가드가 따로 막아서"가 아님을
      // 분명히 한다.
      initialDraft: draft({
        entries: [{ ...makeDraftEntry("db-1", "2027-01-04"), title: "젤다" }],
      }),
      initialRevision: 3,
    });
    actor.send({ type: "FANART_UPLOAD", file });
    expect(actor.getSnapshot().value).toBe("uploading");
    actor.send({ type: "SAVE" });
    expect(saves).toBe(0);
    expect(actor.getSnapshot().value).toBe("uploading");
  });

  it("업로드 중에는 PUBLISH·UNPUBLISH 도 무시한다 — 확인창이 성공처럼 닫히면 안 된다", () => {
    /* 화면이 이 상태를 안 잠그면 확인창을 거쳐 이벤트가 드롭되고, `publishing` 이 false 이고
       오류도 없어 관리자는 발행된 줄 안다(plain 리뷰 10라운드). dirty 는 업로드가 성공할 때까지
       false 라 canPublish 가드도 안 걸린다 — 그래서 잠금이 유일한 표시다. */
    const { promise } = deferred<FanartUploadResult>();
    let publishCalls = 0;
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async () => {
        publishCalls += 1;
        return { published: true, revision: 99 };
      },
      uploadRun: () => promise,
      initialDraft: draft({
        entries: [{ ...makeDraftEntry("db-1", "2027-01-04"), title: "젤다" }],
      }),
      initialRevision: 3,
    });
    actor.send({ type: "FANART_UPLOAD", file });
    expect(actor.getSnapshot().value).toBe("uploading");

    actor.send({ type: "PUBLISH" });
    actor.send({ type: "UNPUBLISH" });
    expect(publishCalls).toBe(0);
    expect(actor.getSnapshot().value).toBe("uploading");
  });

  it("표기 입력은 업로드 중에도 받지만 그림 조작은 안 받는다", () => {
    /* 표기는 다른 편집 이벤트와 같은 자리(루트)라 잠기지 않고, 업로드·내리기는 자식과 같은 값을
       만져 `ready` 안에 있다 — 그 비대칭이 의도라는 것을 못박는다. */
    const { promise } = deferred<FanartUploadResult>();
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      uploadRun: () => promise,
      initialDraft: draft({ fanartImageKey: KEY, fanartCredit: "그린 사람" }),
    });
    actor.send({ type: "FANART_UPLOAD", file });
    actor.send({ type: "FANART_CREDIT_CHANGED", credit: "다른 사람" });
    expect(actor.getSnapshot().context.draft.fanartCredit).toBe("다른 사람");
    // 업로드가 도는 중 내리기는 무시된다(성공하면 새 키가 서므로 결과가 순서에 달린다).
    actor.send({ type: "FANART_REMOVED" });
    expect(actor.getSnapshot().context.draft.fanartImageKey).toBe(KEY);
  });

  it("저장 중에도 그림 조작을 안 받는다 — 화면이 그때 컨트롤을 잠가야 하는 근거다", () => {
    /* 팬아트 이벤트가 `ready` 전용이라는 사실의 **다른 얼굴**이다: 저장 중 내리기를 누르면
       이벤트가 드롭되는데, 화면이 그 상태를 안 잠그면 아무 문구도 없이 눌리는 것처럼만 보인다
       (파일 선택은 더 나쁘다 — input value 를 이미 비워, 같은 파일을 다시 골라도 change 가
       안 난다). 그래서 편집기는 `uploading || saving` 으로 잠근다. */
    const { promise } = deferred<SaveWeekResult>();
    const seeded = draft({
      entries: [{ ...makeDraftEntry("db-1", "2027-01-04"), title: "젤다" }],
      fanartImageKey: KEY,
    });
    const actor = start({ run: () => promise, initialDraft: seeded, initialRevision: 3 });
    actor.send({ type: "SAVE" });
    expect(actor.getSnapshot().value).toBe("saving");

    actor.send({ type: "FANART_REMOVED" });
    expect(actor.getSnapshot().context.draft.fanartImageKey).toBe(KEY);
    actor.send({ type: "FANART_UPLOAD", file });
    expect(actor.getSnapshot().value).toBe("saving"); // uploading 으로 안 간다
  });

  it("FANART_REMOVED 는 넷을 함께 지운다 — 표기만 남으면 저장이 거절된다", () => {
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      initialDraft: draft({ fanartImageKey: KEY, fanartCredit: "그린 사람" }),
    });
    actor.send({ type: "FANART_REMOVED" });
    const d = actor.getSnapshot().context.draft;
    expect(d).toMatchObject({ fanartImageKey: null, fanartCredit: "" });
  });

  it("저장 페이로드에 팬아트 넷이 실린다", async () => {
    let seen: SaveWeekValues | undefined;
    const actor = start({
      run: async (values) => {
        seen = values;
        return { draft: draft(), revision: 1 };
      },
      initialDraft: draft({
        entries: [{ ...makeDraftEntry("db-1", "2027-01-04"), title: "젤다" }],
        fanartImageKey: KEY,
        fanartCredit: "  그린 사람  ",
      }),
    });
    actor.send({ type: "SAVE" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 1);
    expect(seen).toMatchObject({
      fanartImageKey: KEY,
      // 표기는 여기서 trim 해 보낸다 — dirty 비교와 페이로드가 같은 정규형을 봐야 저장 직후
      // draft 가 깨끗해진다(saveValues 주석).
      fanartCredit: "그린 사람",
    });
  });
});

describe("scheduleSaveMachine — PUBLISH·UNPUBLISH 계약(이슈 #56 결정 14 개정)", () => {
  /* 제목을 채워 둔다 — draftHasContent(발행 가드)는 **저장에 실릴 값**만 센다(빈 제목 항목은
     draftEntryInputs 가 버린다). 서버의 weekHasContent 와 같은 기준이라, 제목 없는 항목만 있는
     주는 양쪽 모두에서 "빈 주"다(이슈 #117 결정 9). */
  const savedDraft = draft({
    note: "공지",
    entries: [{ ...makeDraftEntry("db-1", "2027-01-04"), title: "젤다" }],
  });

  it("PUBLISH 는 dirty 하면 가드가 막는다 — publishRun 이 안 불리고 상태도 그대로다", () => {
    let calls = 0;
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async () => {
        calls += 1;
        return { published: true, revision: 99 };
      },
      initialDraft: savedDraft,
      initialRevision: 3,
    });
    actor.send({ type: "NOTE_CHANGED", note: "아직 저장 안 한 변경" });
    actor.send({ type: "PUBLISH" });
    expect(actor.getSnapshot().value).toBe("ready"); // publishing 으로 안 간다
    expect(calls).toBe(0);
    expect(actor.getSnapshot().context.revision).toBe(3);
  });

  /* PUBLISH 와의 비대칭이 핵심이다(Plan 에이전트 리뷰) — 공개를 거두는 건 저장된 값을 새로
     공개하는 게 아니라서 "이미 저장된 값 기준"이 적용될 대상이 없다. 급히 내려야 하는데 마침
     다른 걸 고치던 중이라 막히면 안전이 아니라 방해다. */
  it("UNPUBLISH 는 dirty 해도 막히지 않는다", async () => {
    const publishedDirty = { ...savedDraft, published: true };
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async () => ({ published: false, revision: 8 }),
      initialDraft: publishedDirty,
      initialRevision: 5,
    });
    actor.send({ type: "NOTE_CHANGED", note: "아직 저장 안 한 변경" });
    expect(actor.getSnapshot().context.draft.note).not.toBe(
      actor.getSnapshot().context.baseline.note,
    ); // dirty
    actor.send({ type: "UNPUBLISH" });
    expect(actor.getSnapshot().value).toBe("publishing");
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 8);
    expect(actor.getSnapshot().context.draft.published).toBe(false);
  });

  it("저장된 적 없으면(revision null) PUBLISH 가 막힌다", () => {
    let calls = 0;
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async () => {
        calls += 1;
        return { published: true, revision: 99 };
      },
      initialDraft: savedDraft,
      initialRevision: null,
    });
    actor.send({ type: "PUBLISH" });
    expect(actor.getSnapshot().value).toBe("ready");
    expect(calls).toBe(0);
  });

  it("entries 가 비어 있으면 PUBLISH 가 막힌다(빈 주는 공개 안 한다) — UNPUBLISH 는 막히지 않는다", () => {
    let publishCalls = 0;
    const emptyDraft = draft({ published: true });
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async (values) => {
        publishCalls += 1;
        return { published: values.published, revision: 5 };
      },
      initialDraft: emptyDraft,
      initialRevision: 4,
    });
    actor.send({ type: "PUBLISH" });
    expect(actor.getSnapshot().value).toBe("ready");
    expect(publishCalls).toBe(0);

    actor.send({ type: "UNPUBLISH" });
    expect(actor.getSnapshot().value).toBe("publishing");
  });

  it("PUBLISH 성공 — published 만 병합하고 entries·note 는 그대로, revision 이 갱신된다", async () => {
    let seen: PublishWeekValues | undefined;
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async (values) => {
        seen = values;
        return { published: true, revision: 42 };
      },
      initialDraft: savedDraft,
      initialRevision: 3,
    });
    actor.send({ type: "PUBLISH" });
    expect(actor.getSnapshot().value).toBe("publishing");
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 42);

    expect(seen).toEqual({ weekStartDate: "2027-01-04", revision: 3, published: true });
    const s = actor.getSnapshot();
    expect(s.context.draft.published).toBe(true);
    expect(s.context.baseline.published).toBe(true);
    expect(s.context.draft.note).toBe("공지"); // publishWeek 이 안 건드린 필드는 그대로
    expect(s.context.draft.entries).toBe(savedDraft.entries); // 통째로 안 갈아 끼운다
    expect(s.context.publishError).toBe("");
    expect(s.context.announcement).toBe("발행했습니다");
  });

  it("UNPUBLISH 성공 — 문구가 다르다", async () => {
    const publishedDraft = { ...savedDraft, published: true };
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async () => ({ published: false, revision: 7 }),
      initialDraft: publishedDraft,
      initialRevision: 6,
    });
    actor.send({ type: "UNPUBLISH" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.revision === 7);
    const s = actor.getSnapshot();
    expect(s.context.draft.published).toBe(false);
    expect(s.context.announcement).toBe("비공개로 전환했습니다");
  });

  it("실패하면 publishError 만 세운다 — 저장용 error·announcement·draft·revision 은 안 건드린다", async () => {
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async () => {
        throw new Error("conflict");
      },
      mapError: () => "다른 곳에서 먼저 발행했습니다",
      initialDraft: savedDraft,
      initialRevision: 3,
    });
    actor.send({ type: "PUBLISH" });
    await waitFor(actor, (s) => s.matches("ready") && s.context.publishError !== "");
    const s = actor.getSnapshot();
    expect(s.context.publishError).toBe("다른 곳에서 먼저 발행했습니다");
    expect(s.context.error).toBe("");
    expect(s.context.announcement).toBe("");
    expect(s.context.draft).toBe(savedDraft);
    expect(s.context.revision).toBe(3);
  });

  it("publishing 중 재요청은 무시된다(submit.machine 의 재제출 방어와 같다)", () => {
    const { promise } = deferred<PublishWeekResult>();
    let calls = 0;
    const actor = start({
      run: async () => ({ draft: draft(), revision: 1 }),
      publishRun: async () => {
        calls += 1;
        return promise;
      },
      initialDraft: savedDraft,
      initialRevision: 3,
    });
    actor.send({ type: "PUBLISH" });
    expect(actor.getSnapshot().value).toBe("publishing");
    actor.send({ type: "PUBLISH" });
    expect(calls).toBe(1);
  });
});
