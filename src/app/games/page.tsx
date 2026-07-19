import type { Metadata } from "next";
import "./games.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { makeDb } from "@/db";
import { listGames } from "@/features/games/service";
import { GameBoard } from "./game-board";
import { getServerActor, getServerAuthorities } from "../server-session";
import { OG_IMAGE, OG_LOCALE, OG_SITE_NAME } from "../site-meta";

export const metadata: Metadata = {
  title: "챠이로 쿠냐 — 플레이한 게임",
  description: "챠이로 쿠냐가 플레이한 게임 목록. 방송에서 플레이한 게임 보드.",
  openGraph: {
    siteName: OG_SITE_NAME,
    locale: OG_LOCALE,
    type: "website",
    images: [OG_IMAGE],
    url: "/games",
    title: "챠이로 쿠냐 — 플레이한 게임",
    description: "방송에서 플레이한 게임 보드. 최근에 플레이한 순서로 서 있어요.",
  },
};

/* D1 바인딩을 요청 스코프에서 읽으므로 정적 프리렌더 대상이 아니다 — force-dynamic 으로
   빌드가 이 페이지를 미리 렌더하려다 바인딩을 못 찾고 깨지는 걸 막는다(공개 읽기는 요청마다
   서버가 정본을 준다). */
export const dynamic = "force-dynamic";

export default async function Games() {
  // 목록과 권한은 서로 무관하므로 병렬로 — 직렬로 두면 D1 왕복 하나가 렌더에 그냥 더해진다.
  // UI 분기는 편의일 뿐 — 진짜 방어선은 tRPC 뮤테이션의 서버 인가다(불변식 3). 버튼을 숨겨도
  // 서버가 authorities 를 다시 검사한다.
  const [games, authorities] = await Promise.all([
    // 요청 스코프의 D1 바인딩으로 직접 조립한다 — server-session·tRPC 라우트와 같은 패턴
    // (한때 db/runtime.getDb 가 이 한 곳만을 위해 있었다 — shallow 라 흡수).
    listGames(makeDb(getCloudflareContext().env.DB)),
    getServerActor().then(getServerAuthorities),
  ]);
  /* 보드에 신원(로그인 여부)을 넘기지 않는다. 한때 "비로그인 / 로그인+권한없음"을 갈라 서로
     다른 안내를 띄웠지만, member 역할이 없어 둘 다 영원히 쓰기를 못 얻으므로 구분에 실익이
     없었다(이슈 #22). 권한만 넘기면 보드는 "쓸 수 있나"만 알면 된다 — 불변식 3 과도 결이 맞다. */
  return (
    <main id="main">
      <GameBoard
        initialGames={games}
        canWrite={authorities.has("game:write")}
        canDelete={authorities.has("game:delete")}
      />
    </main>
  );
}
