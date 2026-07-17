import type { NextConfig } from "next";

const nextConfig: NextConfig = {/* 설정은 필요할 때 JIT 로 추가한다 (YAGNI) — 지금은 기본값. */};

export default nextConfig;

// dev 서버에서도 Cloudflare 바인딩(env·D1 등)을 getCloudflareContext() 로 읽게 초기화한다.
// 개발과 프로덕션(Workers)의 바인딩 접근 경로를 하나로 맞춰, "로컬은 되는데 배포는 깨지는"
// 종류의 표류를 없앤다.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
