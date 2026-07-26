"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMD } from "@/core/calendar";
import { formatDate, isPlayDateEditable } from "@/core/games";

/* 클리어 편집의 폼 상태. 플래그(정본)와 선택적 날짜 한 쌍이다 — DB 의 cleared·cleared_date 를
   그대로 옮긴 모양이다. 날짜의 "모름"은 빈 문자열 하나뿐이어야 한다(서버 dateInput 이 null 로
   전처리한다 — 중복 정규화 금지). */
export type ClearedDraft = { cleared: boolean; clearedDate: string };

/* 클리어 수정 모달 전용 — editing 이 null 을 거쳐 매번 리마운트되므로 폼 상태를 여기서 들어도
   이월이 없다. 컴포저는 반대로 한 번 마운트된 채 여러 게임을 거치지만, 이제 클리어를 add 단계에
   두지 않으므로(추가 뒤 편집으로 붙인다) 이 상태는 편집 모달에만 산다. */
export function useClearedDraft(initial: ClearedDraft) {
  const [draft, setDraft] = useState(initial);
  return { draft, setDraft };
}

/* 플레이 날짜 입력. 컴포저(추가)와 클리어 수정이 둘 다 쓴다.

   **여기서 고치는 건 games 컬럼이 아니라 일정 항목이다**(정본은 schedule_entries, 이슈 #56
   결정 3). 그래서 잠기는 경우가 있다: 그 게임이 여러 날 편성돼 있으면(월·화 젤다) 입력 하나로
   표현할 수 없어 날짜를 나열만 하고 /schedule 로 보낸다(core.isPlayDateEditable — 서버도 같은
   판정으로 거절한다).

   dates 가 null 이면 아직 불러오는 중이다. 그동안 입력을 잠그는 이유: 열자마자 빈 칸이 보이면
   "날짜가 없는 게임"으로 읽혀, 응답이 오기 전에 저장한 사용자가 멀쩡한 날짜를 지운다.

   발행 안 내 주의 항목은 보드에 안 뜬다(ADR-0022) — 저장은 되는데 카드에 날짜가 안 보이는
   자리라 안내 한 줄로 미리 말한다. 게임 폼은 주 메타를 안 건드리므로(service.addGame 주석)
   초안을 함부로 발행하지 않는다. */
export function PlayedDateField({
  value,
  onChange,
  idPrefix,
  dates,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  idPrefix: string;
  /* 이 게임에 걸린 일정 날짜 전부. null = 불러오는 중, [] = 없음(새 게임 포함). */
  dates: readonly string[] | null;
  disabled?: boolean;
}) {
  const locked = dates !== null && !isPlayDateEditable(dates);

  if (locked) {
    return (
      <div className="datefield" data-od-id={idPrefix + "-locked"}>
        <span className="datefield__label">플레이한 날</span>
        <p className="datefield__locked">
          {dates.map(formatMD).join(" · ")} <span>({dates.length}일)</span>
        </p>
        <p className="composer__hint">
          여러 날 편성이라 여기선 못 고칩니다 — <Link href="/schedule">일정</Link>에서 고쳐
          주십시오.
        </p>
      </div>
    );
  }

  /* 이미 걸린 항목이 있으면 비우기의 뜻이 "모름"이 아니라 **연결 해제**다 — 그 행은 일정에
     남고 이 게임과의 연결만 풀린다(service.updateGame). 같은 빈 칸이 두 뜻을 가지므로
     그 사실은 화면이 말해야 한다. */
  const hasEntry = dates !== null && dates.length === 1;
  const hintId = idPrefix + "-played-hint";

  /* 그 설명이 한때 **라벨 괄호 안**에 있었다("플레이한 날 (모르면 비워 둬요)"). 두 가지가
     겹쳐 있었다: 라벨은 11px 대문자 간격의 필드 이름 자리라 문장을 담으면 읽는 리듬이 깨지고,
     스크린리더는 그 전체를 입력의 접근 이름으로 낭독한다("플레이한 날 괄호 모르면 비워 둬요").
     이름과 설명을 갈라 라벨엔 이름만 남기고 설명은 aria-describedby 로 잇는다.

     새 게임의 "몰라도 된다"는 여기 안 적는다 — 폼 상단 안내가 날짜 둘을 한 번에 말한다.
     선택 입력임을 필드마다 되풀이하면 그게 소음이고, 연결 해제처럼 **상황에 따라 달라지는
     사실**만 필드 옆에 붙을 값이 있다. */
  return (
    <div className="datefield">
      <label className="datefield__label" htmlFor={idPrefix + "-played"}>
        플레이한 날
      </label>
      <input
        className="field"
        type="date"
        value={value}
        id={idPrefix + "-played"}
        data-od-id={idPrefix + "-played"}
        disabled={disabled || dates === null}
        aria-describedby={hasEntry ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hasEntry && (
        <p className="datefield__hint" id={hintId}>
          비우면 일정에서 이 게임과의 연결만 풀립니다.
        </p>
      )}
    </div>
  );
}

/* 클리어 플래그 + 선택적 날짜. 체크가 정본이고 날짜는 그 아래 딸린다 — 안 깬 게임에 날짜만
   있는 모순을 UI 에서부터 막으려고, 체크를 풀면 날짜 입력을 감추고 값도 비운다(서버 CHECK·
   Zod 가 최종 방어선이지만, 화면에서 애초에 그 조합을 못 만들게 한다). 체크가 켜졌는데 날짜가
   비면 "깼는데 날짜 모름"이라 그대로 유효하다 — 그 표현을 살리는 게 플래그를 날짜와 독립으로
   둔 이유다. type=date 라 형식·실재성(2026-02-31)은 브라우저가 먼저 막는다. */
export function ClearedFields({
  draft,
  onChange,
  idPrefix,
  firstFieldRef,
  disabled = false,
}: {
  draft: ClearedDraft;
  onChange: (next: ClearedDraft) => void;
  idPrefix: string;
  // 모달 오픈 시 포커스를 여기로 옮기려는 호출자를 위한 손잡이(체크박스가 첫 조작점).
  firstFieldRef?: React.Ref<HTMLInputElement>;
  // 서버 쓰기가 날아가는 동안 잠근다 — 그 사이 고친 값은 어차피 이번 저장에 안 실린다.
  disabled?: boolean;
}) {
  return (
    <div className="clearfields">
      <label className="clearfields__toggle" htmlFor={idPrefix + "-cleared"}>
        <input
          type="checkbox"
          checked={draft.cleared}
          id={idPrefix + "-cleared"}
          ref={firstFieldRef}
          disabled={disabled}
          data-od-id={idPrefix + "-cleared"}
          // 체크를 풀면 날짜도 비운다 — 안 깬 게임에 클리어 날짜가 남지 않게(CHECK 의 UI 짝).
          onChange={(e) =>
            onChange(
              e.target.checked ? { ...draft, cleared: true } : { cleared: false, clearedDate: "" },
            )
          }
        />
        {/* 조작의 이름이지 대답이 아니다 — 바로 아래 "클리어한 날"과 한 어휘로 선다
            (상세 값 칸이 표기형으로 돌아간 것과 같은 규약). */}
        <span className="clearfields__togglelabel">클리어함</span>
      </label>
      {draft.cleared && (
        // 라벨엔 이름만 — "모르면 비워 둬요"를 뺀 근거는 PlayedDateField 주석에 있다.
        <div className="datefield">
          <label className="datefield__label" htmlFor={idPrefix + "-date"}>
            클리어한 날
          </label>
          <input
            className="field"
            type="date"
            value={draft.clearedDate}
            id={idPrefix + "-date"}
            data-od-id={idPrefix + "-date"}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, clearedDate: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

/* 게임의 사실 두 줄(플레이한 날·클리어). 카드 상세와 **팬 제안 폼의 "지금 보드에 있는 값"** 이
   나눠 쓴다 — 두 번째 호출자가 생기며 드러난 seam 이라 여기로 뺐다(ADR-0010 의 JIT 추상화).
   두 자리가 같은 값을 다르게 적으면 팬이 제안 폼에서 본 상태와 상세에서 본 상태가 갈린다.

   정의 목록인 이유: "이름: 값" 쌍이라는 걸 마크업이 말해야 스크린리더가 둘을 이어 읽는다
   (문단 두 개로 두면 라벨과 값의 관계가 사라진다).

   **값 칸은 표기형이다 — 대화체 서술을 넣지 않는다.** 한때 "했어요"·"아직이에요"였는데, 같은
   목록의 다른 값이 '2026.03.01' 같은 표기라 이 칸만 어투가 튀어 화면이 가벼워졌다(사용자 지적,
   PR #70). 라벨이 묻고 값이 대답하는 문장이 아니라, 카드 앞면 칩("클리어")이 쓰는 어휘 그대로의
   표기다. 안내문·힌트의 다정한 해요체는 그대로다 — 저긴 값 칸이 아니다. */
export function GameFacts({
  lastPlayed,
  cleared,
  clearedDate,
  idPrefix,
}: {
  lastPlayed: string | null;
  cleared: boolean;
  clearedDate: string | null;
  // data-od-id 접두사. 상세는 "detail" 을 넘겨 기존 e2e 손잡이(detail-played·detail-cleared)를 잇는다.
  idPrefix: string;
}) {
  return (
    <dl className="detail__facts">
      <dt>플레이한 날</dt>
      <dd data-od-id={idPrefix + "-played"}>
        {lastPlayed ? formatDate(lastPlayed) : <span className="detail__none">기록 없음</span>}
      </dd>
      <dt>클리어</dt>
      <dd data-od-id={idPrefix + "-cleared"}>
        {cleared ? (
          clearedDate ? (
            <>{formatDate(clearedDate)} 클리어</>
          ) : (
            // 날짜를 모르는 클리어도 유효한 상태다 — 빈칸으로 두면 안 깬 것처럼 읽힌다.
            // 날짜가 붙은 값과 나란히 놓여야 "날짜만 모른다"가 저절로 드러난다.
            "완료"
          )
        ) : (
          <span className="detail__none">미완료</span>
        )}
      </dd>
    </dl>
  );
}
