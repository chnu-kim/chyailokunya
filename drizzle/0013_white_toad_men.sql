PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedule_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start_date` text NOT NULL,
	`note` text,
	`draft` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`fanart_image_key` text,
	`fanart_credit` text,
	`fanart_image_width` integer,
	`fanart_image_height` integer,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	CONSTRAINT "schedule_weeks_draft" CHECK("__new_schedule_weeks"."draft" = 0 OR "__new_schedule_weeks"."published_at" IS NULL),
	CONSTRAINT "schedule_weeks_fanart" CHECK("__new_schedule_weeks"."fanart_credit" IS NULL OR "__new_schedule_weeks"."fanart_image_key" IS NOT NULL),
	CONSTRAINT "schedule_weeks_fanart_size" CHECK(("__new_schedule_weeks"."fanart_image_width" IS NULL) = ("__new_schedule_weeks"."fanart_image_height" IS NULL)
          AND ("__new_schedule_weeks"."fanart_image_width" IS NULL
               OR ("__new_schedule_weeks"."fanart_image_key" IS NOT NULL
                   AND "__new_schedule_weeks"."fanart_image_width" > 0 AND "__new_schedule_weeks"."fanart_image_height" > 0)))
);
--> statement-breakpoint
--> **손편집.** drizzle-kit 이 SELECT 에도 `"fanart_image_width", "fanart_image_height"` 를 그대로
--> 적었는데 그 시점 옛 테이블엔 그 둘이 **아직 없어서** `no such column` 으로 죽는다. 0008(draft)·
--> 0012(팬아트 두 컬럼)와 같은 자리·같은 이유이고, 로컬 게이트는 마이그레이션을 안 돌려 전부
--> 초록이다 — CHECK 를 건드려 테이블이 재생성되는 마이그레이션은 생성물의 INSERT…SELECT 를
--> 반드시 열어 본다.
-->
--> **0012 와 다른 점:** `fanart_image_key`·`fanart_credit` 은 0012 가 이미 만들었으므로 옛
--> 테이블에 있다 — 그대로 읽는다. NULL 로 채우는 것은 **치수 둘뿐**이다. 유도할 값이 없다:
--> 이미 걸려 있는 그림의 폭·높이는 R2 바이트 안에만 있고, 서빙·저장 어느 경로도 이미지를
--> 만지지 않는다(ADR-0028). 치수가 NULL 인 행은 읽기 화면에서 자리 예약 없이 그려지는
--> 저하 경로를 탄다(db/schema.ts 의 nullable 근거) — 그림이 사라지지는 않는다.
-->
--> 0007 의 지뢰(트랜잭션 안에서는 PRAGMA foreign_keys=OFF 가 무시돼 DROP 이 자식의
--> ON DELETE SET NULL 을 발동시킨다)는 여기서도 재발하지 않는다 — schedule_weeks 를 참조하는
--> 자식 테이블이 없다(0008·0012 주석과 같은 이유).
INSERT INTO `__new_schedule_weeks`("id", "week_start_date", "note", "draft", "published_at", "fanart_image_key", "fanart_credit", "fanart_image_width", "fanart_image_height", "created_at", "last_updated_at") SELECT "id", "week_start_date", "note", "draft", "published_at", "fanart_image_key", "fanart_credit", NULL, NULL, "created_at", "last_updated_at" FROM `schedule_weeks`;--> statement-breakpoint
DROP TABLE `schedule_weeks`;--> statement-breakpoint
ALTER TABLE `__new_schedule_weeks` RENAME TO `schedule_weeks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_weeks_week_start_date_unique` ON `schedule_weeks` (`week_start_date`);