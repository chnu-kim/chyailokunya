import type { Metadata } from "next";
import "./games.css";
import { getDb } from "@/db/runtime";
import { listGames } from "@/features/games/service";
import { GameBoard } from "./game-board";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "../site-meta";

export const metadata: Metadata = {
  title: "챠이로 쿠냐 — 플레이 게임 목록",
  description: "챠이로 쿠냐가 플레이한 게임 목록. 방송에서 플레이한 게임 보드.",
  openGraph: {
    siteName: OG_SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
    images: [OG_IMAGE],
    url: "/games",
    title: "챠이로 쿠냐 — 플레이 게임 목록",
    description: "방송에서 플레이한 게임 보드. 상태로 골라보세요.",
  },
};

/* D1 바인딩을 요청 스코프에서 읽으므로 정적 프리렌더 대상이 아니다 — force-dynamic 으로
   빌드가 이 페이지를 미리 렌더하려다 바인딩을 못 찾고 깨지는 걸 막는다(공개 읽기는 요청마다
   서버가 정본을 준다). */
export const dynamic = "force-dynamic";

export default async function Games() {
  const games = await listGames(getDb());
  return (
    <main id="main">
      <GameBoard initialGames={games} />
    </main>
  );
}
