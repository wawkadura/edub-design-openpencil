CREATE TABLE "screen_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"pin_x" real,
	"pin_y" real,
	"version_n" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"ext" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"note" text,
	"author_kind" text DEFAULT 'user' NOT NULL,
	"author" text NOT NULL,
	"has_thumb" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"section_id" uuid,
	"title" text NOT NULL,
	"platform" text DEFAULT 'autre' NOT NULL,
	"type" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposé' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tickets" text[] DEFAULT '{}'::text[] NOT NULL,
	"design_file_id" uuid,
	"frame_id" text,
	"author_kind" text DEFAULT 'user' NOT NULL,
	"author" text NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screen_comment" ADD CONSTRAINT "screen_comment_screen_id_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_section" ADD CONSTRAINT "screen_section_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_section" ADD CONSTRAINT "screen_section_parent_id_screen_section_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."screen_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_version" ADD CONSTRAINT "screen_version_screen_id_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen" ADD CONSTRAINT "screen_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen" ADD CONSTRAINT "screen_section_id_screen_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."screen_section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen" ADD CONSTRAINT "screen_design_file_id_design_file_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screen_comment_idx" ON "screen_comment" USING btree ("screen_id","created_at");--> statement-breakpoint
CREATE INDEX "screen_section_project_idx" ON "screen_section" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "screen_version_n_idx" ON "screen_version" USING btree ("screen_id","n");--> statement-breakpoint
CREATE INDEX "screen_project_idx" ON "screen" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "screen_section_idx" ON "screen" USING btree ("section_id");