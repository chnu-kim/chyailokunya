import { assign, fromPromise, setup } from "xstate";
import { REQUEST_TIMEOUT_MS } from "./error-message";

/* 제출 상태 기계 — 6곳(에픽 #77 이슈 #80: composer·suggest-dialog·suggestion-inbox·GameEditor·
   GameDeleteConfirm·schedule-editor)에 복붙된 "error + closing + done + useTransition +
   AbortSignal.timeout" 세트를 하나로 묶는다. schedule-editor 는 여기서 안 배선한다 —
   schedule-save 머신(#85)이 이 머신을 자식으로 감싸는 자리라 거기서 한 번에 한다.

   **run 은 얼어붙는다.** useMachine 의 input 은 액터 생성(마운트) 시점에 딱 한 번만 읽혀 context
   에 박히고, 이후 제출마다 그 값을 그대로 재사용한다(XState 의 계약 — 렌더마다 새 input 을 줘도
   무시된다). 그래서 run 이 클로저로 붙잡는 값은 **module-scope 이거나 run 의 인자로 들어오는
   것만**이어야 한다 — 렌더마다 바뀌는 컴포넌트 상태(폼 값·"지금 화면이 상한에 걸렸는가" 같은
   파생값)를 직접 참조하면 마운트 시점 값에 영영 얼어붙는다. **그런 값이 필요하면 submit 이벤트의
   values 에 실어 보낸다** — run(values, signal) 의 values 가 유일한 신선한 통로다.

   **done 은 final 이 아니다.** composer·suggest-dialog·GameEditor·GameDeleteConfirm 은 인스턴스당
   한 번만 제출하고 끝(모달이 닫히거나 결과 화면으로 바뀐다)이지만, suggestion-inbox 는 한 인스턴스가
   열려 있는 동안 항목마다 여러 번 거절을 보낸다 — done 을 final 로 두면 첫 성공 뒤 액터가 죽어
   두 번째 제출을 못 받는다. 그래서 idle 과 done 양쪽에서 submit 을 받는다(재제출은 항상 가능하고,
   한 번만 쓰는 호출자는 그냥 다시 안 부를 뿐이다). */

export type SubmitInput<TValues, TResult> = {
  /** 실제 네트워크 호출. signal 은 이 머신이 만들어 준다(REQUEST_TIMEOUT_MS) — 호출자는 직접
      만들지 않는다. 위 얼어붙음 주석대로, values 외의 렌더 종속 값을 여기서 읽지 않는다. */
  run: (values: TValues, signal: AbortSignal) => Promise<TResult>;
  /** 실패 → 사용자에게 보일 문구. error-message.ts 의 매퍼 6종과 시그니처가 이미 같다. */
  mapError: (error: unknown) => string;
};

type SubmitContext<TValues, TResult> = SubmitInput<TValues, TResult> & {
  values: TValues | undefined;
  error: string;
  result: TResult | undefined;
};

type SubmitEvent<TValues> = { type: "submit"; values: TValues };

export function createSubmitMachine<TValues, TResult>() {
  return setup({
    types: {} as {
      context: SubmitContext<TValues, TResult>;
      events: SubmitEvent<TValues>;
      input: SubmitInput<TValues, TResult>;
    },
    actors: {
      run: fromPromise<TResult, { run: SubmitInput<TValues, TResult>["run"]; values: TValues }>(
        ({ input }) => input.run(input.values, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
      ),
    },
  }).createMachine({
    id: "submit",
    context: ({ input }) => ({ ...input, values: undefined, error: "", result: undefined }),
    initial: "idle",
    states: {
      idle: {
        on: {
          submit: {
            target: "submitting",
            /* result 도 지운다 — 안 지우면 done 을 재사용하는 호출자(suggestion-inbox)가 실패
               뒤에도 이전 성공의 결과를 context 에 들고 있어, s.matches("done") 검사를 빼먹은
               자리에서 옛 성공을 새 제출의 결과로 오독할 수 있다(적대적 리뷰가 잡은 자리). */
            actions: assign({ error: "", result: undefined, values: ({ event }) => event.values }),
          },
        },
      },
      submitting: {
        invoke: {
          src: "run",
          // values 는 바로 위 submit 전이의 assign 이 채운 뒤 여기 들어오므로 항상 있다.
          input: ({ context }) => ({ run: context.run, values: context.values as TValues }),
          onDone: {
            target: "done",
            actions: assign({ result: ({ event }) => event.output }),
          },
          onError: {
            target: "idle",
            actions: assign({ error: ({ context, event }) => context.mapError(event.error) }),
          },
        },
      },
      // idle 과 같은 전이를 그대로 반복한다(result 를 지우는 이유도 같다) — 위 "done 은 final 이
      // 아니다" 참고.
      done: {
        on: {
          submit: {
            target: "submitting",
            actions: assign({ error: "", result: undefined, values: ({ event }) => event.values }),
          },
        },
      },
    },
  });
}
