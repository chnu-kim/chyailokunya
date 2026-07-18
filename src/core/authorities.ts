/* 역할 → 권한(authority) 매핑을 코드 상수로 둔다(ADR-0014·0012). 런타임에 권한을 편집하는
   화면이 v1 에 없으므로 roles/authorities 를 DB 테이블로 승격하지 않는다 — 상수가 더 값싸고
   테스트로 못박히며 인가 핫패스에 DB 왕복이 없다. 이 파일이 인가 규칙의 정본이다.

   member 는 암묵 기본값이라 여기 나오지 않는다: users_roles 에 행이 없으면 member 이고
   authority 는 빈 집합이다. 상승 역할(admin·superadmin)만 저장·매핑한다. */

// 저장되는 역할. 이 배열이 타입·DB enum·CHECK 의 단일 원천이다(db/schema.ts 가 import).
export const ROLES = ["admin", "superadmin"] as const;
export type Role = (typeof ROLES)[number];

// 인가는 role 이 아니라 이 권한 단위로 검사한다 — 세션엔 role 대신 effective authorities 를 싣는다.
export const AUTHORITIES = ["game:write", "game:delete", "role:manage"] as const;
export type Authority = (typeof AUTHORITIES)[number];

/* 상승 가드가 절차가 아니라 매핑으로 구조화된다: superadmin 만 role:manage 를 가져
   admin 은 다른 admin 을 임명·강등할 수 없다. 규칙을 코드로 고정해 테스트가 이 불변식을
   지킨다(자기 승격 구멍을 처음부터 막는다). */
export const ROLE_AUTHORITIES: Record<Role, readonly Authority[]> = {
  admin: ["game:write", "game:delete"],
  superadmin: ["game:write", "game:delete", "role:manage"],
};

// 부여된 역할들의 effective authorities 합집합. member(역할 없음) → 빈 집합.
export function authoritiesFor(roles: Iterable<Role>): Set<Authority> {
  const out = new Set<Authority>();
  for (const role of roles) {
    for (const a of ROLE_AUTHORITIES[role]) out.add(a);
  }
  return out;
}

export function hasAuthority(authorities: ReadonlySet<Authority>, needed: Authority): boolean {
  return authorities.has(needed);
}

// DB·JWT 등 신뢰하지 않는 문자열을 Role 로 좁힐 때. 대괄호 조회 함정을 피해 명시 포함 검사.
export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}
