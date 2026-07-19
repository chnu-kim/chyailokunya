# ADR-0019: 게임 상태를 날짜 두 개에서 유도한다 (status 컬럼 드롭 · 날짜는 text)

- 상태: Accepted
- 날짜: 2026-07-20
- 보완: [ADR-0014](./0014-v1-data-model-schema.md)(v1 데이터 모델)의 `games` 절을 대체한다. [ADR-0015](./0015-chzzk-category-as-game-source.md)(게임 정보원)는 그대로다.

## 맥락

[ADR-0014](./0014-v1-data-model-schema.md)의 `games` 는 상태를 **컬럼**으로 들었다:

```
status      text NOT NULL DEFAULT 'played'
            CHECK(status IN ('playing','cleared','planned','played'))
played_at   integer(ms)
cleared_at  integer(ms)
```

같은 ADR 이 이미 그 아래에 유도 규칙을 적어 뒀다 — "played_at/cleared_at 둘 다 null=예정,
played_at만=플레이중/플레이함, cleared_at까지=클리어." 즉 **한 사실을 두 곳에 적고 있었고**,
둘을 맞춰 주는 장치는 없었다. DB 는 `status='cleared'` 이면서 `cleared_at IS NULL` 인 행을
아무 저항 없이 받았고, 보드 UI 는 상태 칩과 날짜 줄로 그 모순을 그대로 두 번 그렸다.

두 번째 힘은 타임존이다. `played_at` 은 "달력의 하루"지 시각이 아닌데 epoch ms 로 두면
저장할 때 한 번, 표시할 때 한 번 타임존이 개입해 KST 자정 근처의 하루가 밀린다.

세 번째는 정보원이다. [ADR-0015](./0015-chzzk-category-as-game-source.md)가 게임 정보원을
치지직 category API 하나로 정했지만, 한국어 검색에도 안 잡히는 게임은 실제로 있다.
`category_id NOT NULL` 은 그런 게임을 보드에 아예 못 올리게 만들었다.

## 결정

`games` 에서 **`status` 컬럼과 그 CHECK 제약을 드롭하고**, 상태는 날짜 두 개에서 유도한다.
날짜는 `integer`(epoch ms) → `text`('YYYY-MM-DD')로 바꾸고, `category_id` 는 NOT NULL 을
풀어 nullable 로 둔다(UNIQUE 인덱스는 유지).

```
category_id       text            UNIQUE   -- null = 치지직 검색에 없어 손으로 넣은 게임
category_type     text NOT NULL   CHECK(category_type = 'GAME')
category_value    text NOT NULL
poster_image_url  text
played_at         text                     -- 'YYYY-MM-DD', nullable
cleared_at        text                     -- 'YYYY-MM-DD', nullable
created_at        integer(ms) NOT NULL
last_updated_at   integer(ms) NOT NULL
-- "클리어했나" = cleared_at IS NOT NULL. 별도 상태 컬럼은 없다.
```

기존 epoch 값은 **이관하지 않고 버린다**(마이그레이션 `0006_quick_rage.sql` 이 두 날짜를
NULL 로 옮긴다).

## 근거

- **모순을 표현 불가능하게 만든다.** 상태가 유도값이면 "클리어인데 cleared_at 이 null" 이
  타입 수준에서 사라진다. 검증으로 막는 것보다 강하다 — 막을 코드가 없어도 성립한다.
- **타임존을 한 곳으로 몬다.** 텍스트 저장은 타임존 무관이다. KST 는 "오늘이 며칠인가"에서만
  고려하면 되는데, 컴포저가 날짜 기본값을 비워 두기로 하면서 그 한 곳조차 필요 없어졌다
  (`core/games.ts` 의 `todayKST` 는 끝내 호출자가 없어 삭제됐다).
- **정렬이 공짜다.** 'YYYY-MM-DD' 는 사전순 = 시간순이라 문자열 비교로 정렬·순서 검증이 된다.
- **`category_id` nullable 이 수동 입력을 연다.** SQLite 는 UNIQUE 인덱스에서 NULL 중복을
  허용하므로, 치지직 게임의 중복 방지는 그대로 살아 있으면서 손으로 넣은 게임은 여럿이 공존한다.
- **버리는 게 옮기는 것보다 안전하다.** epoch ms 를 TEXT 컬럼에 복사하면 `'1700000000000'`
  같은 문자열이 굳는다 — 날짜로 파싱도 정렬도 안 되는데 형식 검증은 이미 지나간 뒤라 조용히
  남는다. 보드는 관리자가 다시 채울 수 있는 소규모 데이터라 손실 비용이 이관 위험보다 싸다.

## 기각한 대안

- **status 를 두되 트리거·CHECK 로 날짜와 동기화** — SQLite CHECK 는 다른 컬럼을 참조할 수
  있지만, 그렇게까지 해서 지키는 건 결국 "status 는 날짜의 함수"라는 사실이다. 함수라면
  저장하지 말고 계산한다.
- **날짜를 epoch 로 두고 표시에서만 KST 보정** — 보정 지점이 늘어날 때마다 하루 밀림이
  재발한다. 실제로 이 저장소는 자정 근처 하루 밀림을 KST 오프셋 산술로 한 번 겪었다.
- **`played_at` 을 NOT NULL 로** — "플레이한 날을 모른다"가 표현 불가능해진다. 구 보드에서
  옮겨온 게임 다수가 실제로 날짜를 모른다.
- **status 값을 마이그레이션으로 날짜에 역매핑** — `'cleared'` 에서 클리어한 **날**은 나오지
  않는다. 없는 정보를 지어내는 이관이라 기각했다.

## 결과

- (+) 상태·날짜가 어긋난 행이 저장 불가능해졌다. 보드 카드에서 상태 칩과 필터 행이 사라지고
  날짜 한 줄 + 클리어 칩으로 줄었다 — 같은 정보를 두 번 조작하던 UI 가 없어졌다.
- (+) 수동 입력 게임이 가능해졌다(`category_id` null). 컴포저는 검색 결과 0건일 때만 이
  비상구를 연다 — 상시 노출하면 정본 경로보다 쉬운 길이 생겨 보드가 중복 표기로 갈라진다.
- (−) 기존 `played_at`/`cleared_at` 값을 잃는다. 배포 시 관리자가 다시 채워야 한다.
- (−) "예정 / 플레이 중 / 플레이함" 을 구분하지 못한다. 날짜 둘로는 "시작했는데 아직 안 끝남"과
  "그날 하고 말았음"이 같은 모양이다. 이 구분이 실제로 필요해지면 상태를 **다시 컬럼으로
  들이지 말고** 날짜를 늘리는 쪽(`started_at`)을 먼저 검토한다 — 유도 가능성을 유지한다.
- (−) 'YYYY-MM-DD' 는 형식만으로는 실재성을 보장하지 않는다(2026-02-31). `isDateString`
  (core/games.ts)이 왕복 파싱으로 걸러내고, 쓰기는 전부 그 Zod 경계를 지난다.
