ALTER TABLE "screen_section" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "screen" ADD COLUMN "source_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "screen_source_key_idx" ON "screen" USING btree ("project_id","source_key") WHERE "screen"."source_key" is not null;