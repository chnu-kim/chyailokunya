// 순수 도메인 로직의 자리표시자 — HTTP·DB·React 어디에도 의존하지 않는다. dependency-cruiser
// 가 이 레이어를 상위(db·features·ui)로부터 격리하고, Vitest(Workers pool)가 단위로 검증한다.
// 실제 게임 보드 도메인은 Phase 3 에서 이 레이어에 채운다.
export function greet(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? `안녕, ${trimmed}!` : "안녕!";
}
