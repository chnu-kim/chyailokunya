import type { Metadata } from "next";
import "./games.css";
import { GameBoard } from "./game-board";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "../site-meta";

export const metadata: Metadata = {
  title: "챠이로 쿠냐 — 플레이 게임 목록",
  description: "챠이로 쿠냐가 플레이한 게임 목록. 직접 추가·삭제할 수 있는 스크랩북 게임 보드.",
  openGraph: {
    siteName: OG_SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
    images: [OG_IMAGE],
    url: "/games",
    title: "챠이로 쿠냐 — 플레이 게임 목록",
    description: "방송에서 플레이한 게임 보드. 직접 붙이고, 상태로 골라보세요.",
  },
};

export default function Games() {
  return (
    <main id="main">
      <GameBoard />
    </main>
  );
}
