CREATE TABLE "support_ticket_metadata" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "cardId" bigint NOT NULL,
  "externalId" varchar(200) NOT NULL,
  "source" varchar(80) NOT NULL,
  "sourceSystem" varchar(80),
  "userId" varchar(200),
  "emmaUserId" varchar(200),
  "email" varchar(320),
  "customerName" varchar(200),
  "issueCategory" varchar(80),
  "reportedAt" timestamp,
  "sourceChannel" varchar(80),
  "ariSessionId" varchar(200),
  "ariSessionUrl" text,
  "repoFullName" varchar(300),
  "metadata" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp,
  CONSTRAINT "support_ticket_metadata_cardId_unique" UNIQUE("cardId"),
  CONSTRAINT "support_ticket_metadata_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "support_ticket_metadata" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "support_ticket_metadata_source_external_idx" ON "support_ticket_metadata" USING btree ("source", "externalId");
--> statement-breakpoint
CREATE INDEX "support_ticket_metadata_source_system_idx" ON "support_ticket_metadata" USING btree ("sourceSystem");
--> statement-breakpoint
CREATE INDEX "support_ticket_metadata_source_channel_idx" ON "support_ticket_metadata" USING btree ("sourceChannel");
--> statement-breakpoint
CREATE INDEX "support_ticket_metadata_user_idx" ON "support_ticket_metadata" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX "support_ticket_metadata_reported_idx" ON "support_ticket_metadata" USING btree ("reportedAt");
