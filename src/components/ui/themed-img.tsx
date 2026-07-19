"use client";

import { useTheme } from "./use-theme";
import { THEME_DARK } from "./theme-contract";

type ThemedImgProps = {
  lightSrc: string;
  darkSrc: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
};

/* 테마에 따라 src 를 바꾸는 <img>. 구 site.js 의 swapImages([data-img-light][data-img-dark])
   를 컴포넌트로 옮긴 것 — display:none 두 장을 겹치면 브라우저가 둘 다 받고, CSS
   content:url() 로 바꾸면 alt 노출이 엔진마다 달라진다. src 를 직접 갈면 한 장만 받고
   접근성 트리도 그대로다. SSR 은 라이트로 그리고 클라이언트가 다크면 바로잡는다
   (suppressHydrationWarning). 배경 이미지로 충분한 장식(홈 마스코트·쿼카)은 CSS 스왑으로
   두고, alt 가 내용인 이 마스코트만 <img> 로 스왑한다. */
export function ThemedImg({ lightSrc, darkSrc, alt, ...rest }: ThemedImgProps) {
  const theme = useTheme();
  const src = theme === THEME_DARK ? darkSrc : lightSrc;
  return <img src={src} alt={alt} suppressHydrationWarning {...rest} />;
}
