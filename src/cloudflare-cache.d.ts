/* `caches.default` 의 타입(ADR-0028 의 팬아트 서빙이 쓴다).

   런타임엔 있다 — cf-typegen 이 만든 `cloudflare-env.d.ts` 가 `declare abstract class
   CacheStorage { readonly default: Cache }` 로 선언한다. 그런데 tsconfig 의 `lib` 에 `dom` 이
   있어 **lib.dom.d.ts 의 `interface CacheStorage` 가 이긴다**(실측: TS2339). 이 앱은 클라이언트
   컴포넌트를 같은 tsconfig 아래 담으므로 dom lib 을 뺄 수 없다 — 그래서 전역 interface 를
   보강해 두 세계를 맞춘다(cloudflare-secrets.d.ts 와 같은 방식).

   `caches.open("…")` 으로 우회하지 않는 이유: 그건 별도 네임스페이스의 캐시라 zone 캐시와
   통합되는 `default` 와 동작이 다르다. 타입을 맞추려고 런타임 동작을 바꾸는 것은 순서가
   뒤집힌 해법이다. */
declare global {
  interface CacheStorage {
    readonly default: Cache;
  }
}

export {};
