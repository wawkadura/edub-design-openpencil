CREATE TABLE "mcp_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"project" text,
	"ok" boolean NOT NULL,
	"error" text,
	"ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_token_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "mcp_call" ADD CONSTRAINT "mcp_call_token_id_mcp_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_call_token_idx" ON "mcp_call" USING btree ("token_id","created_at");