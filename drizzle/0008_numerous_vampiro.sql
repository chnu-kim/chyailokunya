-- 주 메타에 draft 축을 더한다(이슈 #64 · ADR-0022). SQLite 엔 CHECK 추가가 없어 테이블
-- 재생성으로 간다. **기존 행의 draft 는 현행 동작을 그대로 보존하도록 유도한다**:
-- 미발행 주(published_at NULL)는 지금도 보드에서 빠지므로 초안(1), 발행된 주는 보드에 뜨므로
-- 확정(0). 그래서 이 마이그레이션 뒤 화면이 한 픽셀도 안 바뀐다.
--
-- 이관된 레거시 주는 메타 행이 **아예 없어서** 여기 안 걸린다 — 새 규칙에서도 LEFT JOIN 미스가
-- coalesce(draft, 0)=0 으로 접혀 보드에 그대로 남는다(손실 0, 이슈 #56 결정 16 유지).
--
-- 0007 의 지뢰(트랜잭션 안에서는 PRAGMA foreign_keys=OFF 가 무시돼 DROP 이 자식의
-- ON DELETE SET NULL 을 발동시킨다)는 여기서 재발하지 않는다: schedule_weeks 를 참조하는
-- 자식 테이블이 없다(주는 저장하지 않고 날짜에서 유도하므로 week_id FK 자체가 없다 — 결정 2).
-- 그래서 아래 pragma 는 있으나 마나이고, 이 이관은 pragma 에 기대지 않는다.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedule_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start_date` text NOT NULL,
	`note` text,
	`draft` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`last_updated_at` integer NOT NULL,
	CONSTRAINT "schedule_weeks_draft" CHECK("__new_schedule_weeks"."draft" = 0 OR "__new_schedule_weeks"."published_at" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_schedule_weeks`("id", "week_start_date", "note", "draft", "published_at", "created_at", "last_updated_at") SELECT "id", "week_start_date", "note", CASE WHEN "published_at" IS NULL THEN 1 ELSE 0 END, "published_at", "created_at", "last_updated_at" FROM `schedule_weeks`;--> statement-breakpoint
DROP TABLE `schedule_weeks`;--> statement-breakpoint
ALTER TABLE `__new_schedule_weeks` RENAME TO `schedule_weeks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_weeks_week_start_date_unique` ON `schedule_weeks` (`week_start_date`);