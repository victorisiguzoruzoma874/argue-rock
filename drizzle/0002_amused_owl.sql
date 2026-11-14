CREATE TABLE "near_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"verdict_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"verdict_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "near_settlements_competition_uq" UNIQUE("competition_id")
);
--> statement-breakpoint
CREATE TABLE "near_stakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" text NOT NULL,
	"near_account_id" text NOT NULL,
	"amount_yocto" text NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "near_stakes_competition_side_uq" UNIQUE("competition_id","side"),
	CONSTRAINT "near_stakes_tx_uq" UNIQUE("tx_hash"),
	CONSTRAINT "near_stakes_side" CHECK ("near_stakes"."side" in ('A', 'B'))
);
--> statement-breakpoint
ALTER TABLE "near_settlements" ADD CONSTRAINT "near_settlements_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "near_settlements" ADD CONSTRAINT "near_settlements_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "near_settlements" ADD CONSTRAINT "near_settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "near_stakes" ADD CONSTRAINT "near_stakes_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "near_stakes" ADD CONSTRAINT "near_stakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;