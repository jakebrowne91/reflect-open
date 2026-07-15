ALTER TABLE "support_ticket_metadata" ADD COLUMN IF NOT EXISTS "supportCaseId" varchar(80);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_metadata_support_case_idx" ON "support_ticket_metadata" USING btree ("supportCaseId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_case_thread" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "cardId" bigint NOT NULL,
  "supportCaseId" varchar(80),
  "sourceCaseKey" varchar(300),
  "provider" varchar(80) NOT NULL,
  "mailbox" varchar(320),
  "providerThreadId" varchar(300) NOT NULL,
  "firstProviderMessageId" varchar(300),
  "latestProviderMessageId" varchar(300),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp,
  CONSTRAINT "support_case_thread_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "support_case_thread" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_case_thread_provider_uidx" ON "support_case_thread" USING btree ("provider", "mailbox", "providerThreadId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_case_thread_card_idx" ON "support_case_thread" USING btree ("cardId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_case_thread_support_case_idx" ON "support_case_thread" USING btree ("supportCaseId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_case_thread_source_case_idx" ON "support_case_thread" USING btree ("sourceCaseKey");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_email_message" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "cardId" bigint,
  "source" varchar(80) DEFAULT 'email' NOT NULL,
  "sourceEventId" varchar(300) NOT NULL,
  "sourceCaseKey" varchar(300),
  "supportCaseId" varchar(80),
  "direction" varchar(20) NOT NULL,
  "eventType" varchar(80) DEFAULT 'inbound_email' NOT NULL,
  "provider" varchar(80),
  "mailbox" varchar(320),
  "providerMessageId" varchar(300),
  "providerThreadId" varchar(300),
  "replyToMessageId" varchar(300),
  "customerEmail" varchar(320),
  "customerName" varchar(200),
  "subject" text,
  "bodyText" text,
  "bodyHtml" text,
  "summary" text,
  "classification" jsonb,
  "extraction" jsonb,
  "decision" jsonb,
  "raw" jsonb,
  "processingStatus" varchar(80) DEFAULT 'received' NOT NULL,
  "receivedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp,
  CONSTRAINT "support_email_message_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "support_email_message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_email_message_source_event_uidx" ON "support_email_message" USING btree ("source", "sourceEventId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_email_message_card_created_idx" ON "support_email_message" USING btree ("cardId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_email_message_case_created_idx" ON "support_email_message" USING btree ("supportCaseId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_email_message_thread_idx" ON "support_email_message" USING btree ("provider", "providerThreadId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_email_message_source_case_idx" ON "support_email_message" USING btree ("source", "sourceCaseKey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_email_message_customer_idx" ON "support_email_message" USING btree ("customerEmail");
