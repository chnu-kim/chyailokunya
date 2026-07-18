/* access 토큰 서명용 EdDSA(Ed25519) 키쌍을 생성해 JWK 로 출력한다(ADR-0017). 출력 두 줄을
   .dev.vars(로컬)에 붙이고, 프로덕션은 `wrangler secret put JWT_SIGNING_JWK`/`JWT_PUBLIC_JWK`
   또는 1Password Environment 로 주입한다. private(d 포함)은 서명 경로에만, public 은 검증 경로에.
   kid='v1' — 회전 시 kid 를 올려 다중 키를 둔다. 실행: `npm run gen-jwt-keys`. */

import { exportJWK, generateKeyPair } from "jose";

const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
const priv = { ...(await exportJWK(privateKey)), kid: "v1", alg: "EdDSA" };
const pub = { ...(await exportJWK(publicKey)), kid: "v1", alg: "EdDSA" };

console.log("# .dev.vars 에 아래 두 줄을 넣으세요(커밋 금지):");
console.log("JWT_SIGNING_JWK=" + JSON.stringify(priv));
console.log("JWT_PUBLIC_JWK=" + JSON.stringify(pub));
