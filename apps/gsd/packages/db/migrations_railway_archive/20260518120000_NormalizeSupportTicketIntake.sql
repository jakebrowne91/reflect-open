ALTER TABLE "support_ticket_metadata" ADD COLUMN IF NOT EXISTS "sourceCaseKey" varchar(300);
--> statement-breakpoint
ALTER TABLE "support_ticket_metadata" ADD COLUMN IF NOT EXISTS "sourceEventId" varchar(300);
--> statement-breakpoint
ALTER TABLE "support_ticket_metadata" ADD COLUMN IF NOT EXISTS "provider" varchar(80);
--> statement-breakpoint
ALTER TABLE "support_ticket_metadata" ADD COLUMN IF NOT EXISTS "providerThreadId" varchar(300);
--> statement-breakpoint
ALTER TABLE "support_ticket_metadata" ADD COLUMN IF NOT EXISTS "providerMessageId" varchar(300);
--> statement-breakpoint
ALTER TABLE "support_ticket_metadata" ADD COLUMN IF NOT EXISTS "mailbox" varchar(320);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_metadata_source_case_idx" ON "support_ticket_metadata" USING btree ("source", "sourceCaseKey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_metadata_provider_thread_idx" ON "support_ticket_metadata" USING btree ("provider", "providerThreadId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_ticket_event" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "cardId" bigint NOT NULL,
  "source" varchar(80) NOT NULL,
  "sourceEventId" varchar(300) NOT NULL,
  "sourceCaseKey" varchar(300),
  "eventType" varchar(80) NOT NULL,
  "status" varchar(80),
  "summary" text,
  "payload" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "support_ticket_event_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "support_ticket_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_ticket_event_source_event_uidx" ON "support_ticket_event" USING btree ("source", "sourceEventId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_event_card_created_idx" ON "support_ticket_event" USING btree ("cardId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_event_source_case_idx" ON "support_ticket_event" USING btree ("source", "sourceCaseKey");
