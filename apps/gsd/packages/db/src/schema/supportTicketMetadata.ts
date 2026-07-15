import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { cards } from "./cards";

export const supportTicketMetadata = pgTable(
  "gsd_support_ticket_metadata",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" })
      .unique(),
    externalId: varchar("externalId", { length: 200 }).notNull(),
    source: varchar("source", { length: 80 }).notNull(),
    sourceCaseKey: varchar("sourceCaseKey", { length: 300 }),
    supportCaseId: varchar("supportCaseId", { length: 80 }),
    sourceEventId: varchar("sourceEventId", { length: 300 }),
    sourceSystem: varchar("sourceSystem", { length: 80 }),
    userId: varchar("userId", { length: 200 }),
    emmaUserId: varchar("emmaUserId", { length: 200 }),
    email: varchar("email", { length: 320 }),
    customerName: varchar("customerName", { length: 200 }),
    issueCategory: varchar("issueCategory", { length: 80 }),
    reportedAt: timestamp("reportedAt"),
    sourceChannel: varchar("sourceChannel", { length: 80 }),
    provider: varchar("provider", { length: 80 }),
    providerThreadId: varchar("providerThreadId", { length: 300 }),
    providerMessageId: varchar("providerMessageId", { length: 300 }),
    mailbox: varchar("mailbox", { length: 320 }),
    ariSessionId: varchar("ariSessionId", { length: 200 }),
    ariSessionUrl: text("ariSessionUrl"),
    repoFullName: varchar("repoFullName", { length: 300 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [
    index("gsd_support_ticket_metadata_source_external_idx").on(
      table.source,
      table.externalId,
    ),
    index("gsd_support_ticket_metadata_source_case_idx").on(
      table.source,
      table.sourceCaseKey,
    ),
    index("gsd_support_ticket_metadata_support_case_idx").on(
      table.supportCaseId,
    ),
    index("gsd_support_ticket_metadata_provider_thread_idx").on(
      table.provider,
      table.providerThreadId,
    ),
    index("gsd_support_ticket_metadata_source_system_idx").on(
      table.sourceSystem,
    ),
    index("gsd_support_ticket_metadata_source_channel_idx").on(
      table.sourceChannel,
    ),
    index("gsd_support_ticket_metadata_user_idx").on(table.userId),
    index("gsd_support_ticket_metadata_reported_idx").on(table.reportedAt),
  ],
).enableRLS();

export const supportTicketMetadataRelations = relations(
  supportTicketMetadata,
  ({ one }) => ({
    card: one(cards, {
      fields: [supportTicketMetadata.cardId],
      references: [cards.id],
    }),
  }),
);

export const supportTicketEvents = pgTable(
  "gsd_support_ticket_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 80 }).notNull(),
    sourceEventId: varchar("sourceEventId", { length: 300 }).notNull(),
    sourceCaseKey: varchar("sourceCaseKey", { length: 300 }),
    eventType: varchar("eventType", { length: 80 }).notNull(),
    status: varchar("status", { length: 80 }),
    summary: text("summary"),
    payload: jsonb("payload"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("gsd_support_ticket_event_source_event_uidx").on(
      table.source,
      table.sourceEventId,
    ),
    index("gsd_support_ticket_event_card_created_idx").on(
      table.cardId,
      table.createdAt,
    ),
    index("gsd_support_ticket_event_source_case_idx").on(
      table.source,
      table.sourceCaseKey,
    ),
  ],
).enableRLS();

export const supportTicketEventsRelations = relations(
  supportTicketEvents,
  ({ one }) => ({
    card: one(cards, {
      fields: [supportTicketEvents.cardId],
      references: [cards.id],
    }),
  }),
);

export const supportCaseThreads = pgTable(
  "gsd_support_case_thread",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    supportCaseId: varchar("supportCaseId", { length: 80 }),
    sourceCaseKey: varchar("sourceCaseKey", { length: 300 }),
    provider: varchar("provider", { length: 80 }).notNull(),
    mailbox: varchar("mailbox", { length: 320 }),
    providerThreadId: varchar("providerThreadId", { length: 300 }).notNull(),
    firstProviderMessageId: varchar("firstProviderMessageId", { length: 300 }),
    latestProviderMessageId: varchar("latestProviderMessageId", {
      length: 300,
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [
    uniqueIndex("gsd_support_case_thread_provider_uidx").on(
      table.provider,
      table.mailbox,
      table.providerThreadId,
    ),
    index("gsd_support_case_thread_card_idx").on(table.cardId),
    index("gsd_support_case_thread_support_case_idx").on(table.supportCaseId),
    index("gsd_support_case_thread_source_case_idx").on(table.sourceCaseKey),
  ],
).enableRLS();

export const supportCaseThreadsRelations = relations(
  supportCaseThreads,
  ({ one }) => ({
    card: one(cards, {
      fields: [supportCaseThreads.cardId],
      references: [cards.id],
    }),
  }),
);

export const supportEmailMessages = pgTable(
  "gsd_support_email_message",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cardId: bigint("cardId", { mode: "number" }).references(() => cards.id, {
      onDelete: "set null",
    }),
    source: varchar("source", { length: 80 }).notNull().default("email"),
    sourceEventId: varchar("sourceEventId", { length: 300 }).notNull(),
    sourceCaseKey: varchar("sourceCaseKey", { length: 300 }),
    supportCaseId: varchar("supportCaseId", { length: 80 }),
    direction: varchar("direction", { length: 20 }).notNull(),
    eventType: varchar("eventType", { length: 80 })
      .notNull()
      .default("inbound_email"),
    provider: varchar("provider", { length: 80 }),
    mailbox: varchar("mailbox", { length: 320 }),
    providerMessageId: varchar("providerMessageId", { length: 300 }),
    providerThreadId: varchar("providerThreadId", { length: 300 }),
    replyToMessageId: varchar("replyToMessageId", { length: 300 }),
    customerEmail: varchar("customerEmail", { length: 320 }),
    customerName: varchar("customerName", { length: 200 }),
    subject: text("subject"),
    bodyText: text("bodyText"),
    bodyHtml: text("bodyHtml"),
    summary: text("summary"),
    classification: jsonb("classification"),
    extraction: jsonb("extraction"),
    decision: jsonb("decision"),
    raw: jsonb("raw"),
    processingStatus: varchar("processingStatus", { length: 80 })
      .notNull()
      .default("received"),
    receivedAt: timestamp("receivedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [
    uniqueIndex("gsd_support_email_message_source_event_uidx").on(
      table.source,
      table.sourceEventId,
    ),
    index("gsd_support_email_message_card_created_idx").on(
      table.cardId,
      table.createdAt,
    ),
    index("gsd_support_email_message_case_created_idx").on(
      table.supportCaseId,
      table.createdAt,
    ),
    index("gsd_support_email_message_thread_idx").on(
      table.provider,
      table.providerThreadId,
    ),
    index("gsd_support_email_message_source_case_idx").on(
      table.source,
      table.sourceCaseKey,
    ),
    index("gsd_support_email_message_customer_idx").on(table.customerEmail),
  ],
).enableRLS();

export const supportEmailMessagesRelations = relations(
  supportEmailMessages,
  ({ one }) => ({
    card: one(cards, {
      fields: [supportEmailMessages.cardId],
      references: [cards.id],
    }),
  }),
);
