CREATE TYPE "public"."principal_kind" AS ENUM('user', 'group');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_kind" text,
	"target_name" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_member" DROP CONSTRAINT "project_member_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "project_member_user_idx";--> statement-breakpoint
ALTER TABLE "project_member" DROP CONSTRAINT "project_member_project_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "design_file" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "design_file" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "design_file" ADD COLUMN "screen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "principal_kind" "principal_kind";--> statement-breakpoint
ALTER TABLE "project_member" ADD COLUMN "principal" text;--> statement-breakpoint
UPDATE "project_member" pm SET "principal_kind" = 'user', "principal" = u."username" FROM "user" u WHERE u."id" = pm."user_id";--> statement-breakpoint
ALTER TABLE "project_member" ALTER COLUMN "principal_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_member" ALTER COLUMN "principal" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_principal_kind_principal_pk" PRIMARY KEY("project_id","principal_kind","principal");--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_parent_id_folder_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_project_idx" ON "activity" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "folder_project_idx" ON "folder" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "design_file" ADD CONSTRAINT "design_file_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_member_principal_idx" ON "project_member" USING btree ("principal_kind","principal");--> statement-breakpoint
ALTER TABLE "project_member" DROP COLUMN "user_id";