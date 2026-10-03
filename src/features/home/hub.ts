/* 홈 세 갈래 카드의 상태 줄을 읽는 자리. 상태 줄은 **부가 정보**다 — 홈의 일은 갈림길을 보여
   주는 것이고, 그 일은 D1 없이도 된다. 그래서 여기서 실패를 삼켜 null 을 돌려준다: 조회가 하나라도
   던지면 홈 전체가 500 이 되던 것을(codex 적대적 리뷰, PR #150) 상태 줄만 빠지는 것으로 좁힌다.

   **실패를 "준비 중"으로 위장하지 않는다.** 모를 때 미발행이라고 적으면 이미 공개된 주를 두고
   거짓을 말한다 — 모르면 아무것도 안 적는다(null → 화면이 상태 줄을 안 그린다). */
import { weekStartOf, type IsoDate } from "@/core/calendar";
import { homeHubStatus, type HomeHubStatus } from "@/core/home-hub";
import type { Db } from "@/db";
import { mostRecentPlayedGameName } from "@/features/games/service";
import { isWeekPublished } from "@/features/schedule/service";

export async function loadHomeHub(db: Db, today: IsoDate): Promise<HomeHubStatus | null> {
  try {
    const [weekPublished, recentGame] = await Promise.all([
      isWeekPublished(db, weekStartOf(today)),
      mostRecentPlayedGameName(db),
    ]);
    return homeHubStatus({ today, weekPublished, recentGame });
  } catch (error) {
    // 삼키되 흔적은 남긴다 — wrangler tail 이 이 줄로 D1 장애를 보여 준다.
    console.error("home hub status unavailable", error);
    return null;
  }
}
