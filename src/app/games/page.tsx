import type { Metadata } from "next";
import "./games.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { makeDb } from "@/db";
import { listGames } from "@/features/games/service";
import { countPendingSuggestions } from "@/features/suggestions/service";
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
    description: "방송에서 플레이한 게임 보드. 최근에 플레이한 순서로 서 있습니다.",
  },
};

/* D1 바인딩을 요청 스코프에서 읽으므로 정적 프리렌더 대상이 아니다 — force-dynamic 으로
   빌드가 이 페이지를 미리 렌더하려다 바인딩을 못 찾고 깨지는 걸 막는다(공개 읽기는 요청마다
   서버가 정본을 준다). */
export const dynamic = "force-dynamic";

export default async function Games() {
  // 요청 스코프의 D1 바인딩으로 직접 조립한다 — server-session·tRPC 라우트와 같은 패턴
  // (한때 db/runtime.getDb 가 이 한 곳만을 위해 있었다 — shallow 라 흡수).
  const db = makeDb(getCloudflareContext().env.DB);
  /* 목록과 권한은 서로 무관하므로 병렬로 — 직렬로 두면 D1 왕복 하나가 렌더에 그냥 더해진다.
     getServerActor 를 두 번 부르는 건 중복이 아니다(react cache 로 요청 스코프 메모이즈).
     UI 분기는 편의일 뿐 — 진짜 방어선은 tRPC 의 서버 인가다(불변식 3). */
  const [games, authorities, actor] = await Promise.all([
    listGames(db),
    getServerActor().then(getServerAuthorities),
    getServerActor(),
  ]);
  const canWrite = authorities.has("game:write");
  /* **신원(로그인 여부)을 넘긴다.** 한때 안 넘겼고 근거는 "비로그인과 로그인+권한없음을 갈라도
     둘 다 영원히 쓰기를 못 얻으니 실익이 없다"였는데(이슈 #22), 팬 제안이 그 전제를 뒤집었다 —
     이제 로그인한 사람만 할 수 있는 일이 실재하므로 그 둘의 화면이 갈려야 한다(ADR-0025).

     미처리 제안 수는 **관리자일 때만** 센다. 공개 읽기에 왕복을 더하지 않으려는 것이고, 그래서
     위 병렬 묶음에 못 넣는다(canWrite 를 알아야 셀지 정해진다). 관리자는 소수라 그 직렬 한 번이
     공개 트래픽에 얹히지 않는다. */
  const initialPending = canWrite ? await countPendingSuggestions(db) : 0;
  return (
    <main id="main">
      <GameBoard
        initialGames={games}
        canWrite={canWrite}
        canDelete={authorities.has("game:delete")}
        signedIn={actor !== null}
        initialPending={initialPending}
      />
    </main>
  );
}
