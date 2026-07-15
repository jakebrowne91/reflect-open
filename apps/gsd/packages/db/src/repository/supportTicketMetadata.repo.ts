import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cards,
  lists,
  supportCaseThreads,
  supportEmailMessages,
  supportTicketEvents,
  supportTicketMetadata,
} from "@kan/db/schema";

export const upsertForCard = async (
  db: dbClient,
  input: {
    cardId: number;
    externalId: string;
    source: string;
    sourceCaseKey?: string | null;
    supportCaseId?: string | null;
    sourceEventId?: string | null;
    sourceSystem?: string | null;
    userId?: string | null;
    emmaUserId?: string | null;
    email?: string | null;
    customerName?: string | null;
    issueCategory?: string | null;
    reportedAt?: Date | null;
    sourceChannel?: string | null;
    provider?: string | null;
    providerThreadId?: string | null;
    providerMessageId?: string | null;
    mailbox?: string | null;
    ariSessionId?: string | null;
    ariSessionUrl?: string | null;
    repoFullName?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) => {
  const [result] = await db
    .insert(supportTicketMetadata)
    .values({
      cardId: input.cardId,
      externalId: input.externalId,
      source: input.source,
      sourceCaseKey: input.sourceCaseKey ?? null,
      supportCaseId: input.supportCaseId ?? null,
      sourceEventId: input.sourceEventId ?? input.externalId,
      sourceSystem: input.sourceSystem ?? input.source,
      userId: input.userId ?? null,
      emmaUserId: input.emmaUserId ?? null,
      email: input.email ?? null,
      customerName: input.customerName ?? null,
      issueCategory: input.issueCategory ?? null,
      reportedAt: input.reportedAt ?? null,
      sourceChannel: input.sourceChannel ?? null,
      provider: input.provider ?? null,
      providerThreadId: input.providerThreadId ?? null,
      providerMessageId: input.providerMessageId ?? null,
      mailbox: input.mailbox ?? null,
      ariSessionId: input.ariSessionId ?? null,
      ariSessionUrl: input.ariSessionUrl ?? null,
      repoFullName: input.repoFullName ?? null,
      metadata: input.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: supportTicketMetadata.cardId,
      set: {
        externalId: input.externalId,
        source: input.source,
        sourceCaseKey: input.sourceCaseKey ?? null,
        supportCaseId: input.supportCaseId ?? null,
        sourceEventId: input.sourceEventId ?? input.externalId,
        sourceSystem: input.sourceSystem ?? input.source,
        userId: input.userId ?? null,
        emmaUserId: input.emmaUserId ?? null,
        email: input.email ?? null,
        customerName: input.customerName ?? null,
        issueCategory: input.issueCategory ?? null,
        reportedAt: input.reportedAt ?? null,
        sourceChannel: input.sourceChannel ?? null,
        provider: input.provider ?? null,
        providerThreadId: input.providerThreadId ?? null,
        providerMessageId: input.providerMessageId ?? null,
        mailbox: input.mailbox ?? null,
        ariSessionId: input.ariSessionId ?? null,
        ariSessionUrl: input.ariSessionUrl ?? null,
        repoFullName: input.repoFullName ?? null,
        metadata: input.metadata ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return result;
};

export const getByCardId = async (db: dbClient, cardId: number) =>
  db.query.supportTicketMetadata.findFirst({
    where: eq(supportTicketMetadata.cardId, cardId),
  });

export const getByCardPublicId = async (
  db: dbClient,
  args: { cardPublicId: string },
) => {
  const card = await db.query.cards.findFirst({
    columns: {
      id: true,
      publicId: true,
      cardNumber: true,
      title: true,
      description: true,
      createdBy: true,
      listId: true,
    },
    where: eq(cards.publicId, args.cardPublicId),
    with: {
      list: {
        columns: {
          id: true,
          publicId: true,
          name: true,
          boardId: true,
        },
      },
      supportTicketMetadata: true,
    },
  });

  if (!card?.supportTicketMetadata) return null;
  return {
    ...card.supportTicketMetadata,
    card,
  };
};

export const getBySourceCaseKey = async (
  db: dbClient,
  args: { source: string; sourceCaseKey: string },
) =>
  db.query.supportTicketMetadata.findFirst({
    where: and(
      eq(supportTicketMetadata.source, args.source),
      eq(supportTicketMetadata.sourceCaseKey, args.sourceCaseKey),
    ),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          cardNumber: true,
          title: true,
          description: true,
          createdBy: true,
          listId: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              publicId: true,
              name: true,
              boardId: true,
            },
          },
        },
      },
    },
  });

export const getBySupportCaseId = async (
  db: dbClient,
  args: { supportCaseId: string },
) =>
  db.query.supportTicketMetadata.findFirst({
    where: eq(supportTicketMetadata.supportCaseId, args.supportCaseId),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          cardNumber: true,
          title: true,
          description: true,
          createdBy: true,
          listId: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              publicId: true,
              name: true,
              boardId: true,
            },
          },
        },
      },
    },
  });

export const getByProviderThread = async (
  db: dbClient,
  args: { provider: string; providerThreadId: string; mailbox?: string | null },
) =>
  db.query.supportCaseThreads.findFirst({
    where: and(
      eq(supportCaseThreads.provider, args.provider),
      eq(supportCaseThreads.providerThreadId, args.providerThreadId),
      args.mailbox ? eq(supportCaseThreads.mailbox, args.mailbox) : undefined,
    ),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          cardNumber: true,
          title: true,
          description: true,
          createdBy: true,
          listId: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              publicId: true,
              name: true,
              boardId: true,
            },
          },
          supportTicketMetadata: true,
        },
      },
    },
  });

export const getBySourceExternalId = async (
  db: dbClient,
  args: { source: string; externalId: string },
) =>
  db.query.supportTicketMetadata.findFirst({
    where: and(
      eq(supportTicketMetadata.source, args.source),
      eq(supportTicketMetadata.externalId, args.externalId),
    ),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          cardNumber: true,
          title: true,
          description: true,
          createdBy: true,
          listId: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              publicId: true,
              name: true,
              boardId: true,
            },
          },
        },
      },
    },
  });

export const getEventBySourceEventId = async (
  db: dbClient,
  args: { source: string; sourceEventId: string },
) =>
  db.query.supportTicketEvents.findFirst({
    where: and(
      eq(supportTicketEvents.source, args.source),
      eq(supportTicketEvents.sourceEventId, args.sourceEventId),
    ),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          cardNumber: true,
          title: true,
          description: true,
          createdBy: true,
          listId: true,
        },
      },
    },
  });

export const createEventIfNew = async (
  db: dbClient,
  input: {
    cardId: number;
    source: string;
    sourceEventId: string;
    sourceCaseKey?: string | null;
    eventType: string;
    status?: string | null;
    summary?: string | null;
    payload?: Record<string, unknown> | null;
  },
) => {
  const [event] = await db
    .insert(supportTicketEvents)
    .values({
      cardId: input.cardId,
      source: input.source,
      sourceEventId: input.sourceEventId,
      sourceCaseKey: input.sourceCaseKey ?? null,
      eventType: input.eventType,
      status: input.status ?? null,
      summary: input.summary ?? null,
      payload: input.payload ?? null,
    })
    .onConflictDoNothing({
      target: [supportTicketEvents.source, supportTicketEvents.sourceEventId],
    })
    .returning();

  return event ?? null;
};

export const upsertThreadForCard = async (
  db: dbClient,
  input: {
    cardId: number;
    supportCaseId?: string | null;
    sourceCaseKey?: string | null;
    provider: string;
    mailbox?: string | null;
    providerThreadId: string;
    providerMessageId?: string | null;
  },
) => {
  const [thread] = await db
    .insert(supportCaseThreads)
    .values({
      cardId: input.cardId,
      supportCaseId: input.supportCaseId ?? null,
      sourceCaseKey: input.sourceCaseKey ?? null,
      provider: input.provider,
      mailbox: input.mailbox ?? null,
      providerThreadId: input.providerThreadId,
      firstProviderMessageId: input.providerMessageId ?? null,
      latestProviderMessageId: input.providerMessageId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        supportCaseThreads.provider,
        supportCaseThreads.mailbox,
        supportCaseThreads.providerThreadId,
      ],
      set: {
        cardId: input.cardId,
        supportCaseId: input.supportCaseId ?? null,
        sourceCaseKey: input.sourceCaseKey ?? null,
        latestProviderMessageId: input.providerMessageId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return thread;
};

export const upsertEmailMessage = async (
  db: dbClient,
  input: {
    cardId?: number | null;
    source?: string;
    sourceEventId: string;
    sourceCaseKey?: string | null;
    supportCaseId?: string | null;
    direction: "inbound" | "outbound";
    eventType?: string;
    provider?: string | null;
    mailbox?: string | null;
    providerMessageId?: string | null;
    providerThreadId?: string | null;
    replyToMessageId?: string | null;
    customerEmail?: string | null;
    customerName?: string | null;
    subject?: string | null;
    bodyText?: string | null;
    bodyHtml?: string | null;
    summary?: string | null;
    classification?: Record<string, unknown> | null;
    extraction?: Record<string, unknown> | null;
    decision?: Record<string, unknown> | null;
    raw?: Record<string, unknown> | null;
    processingStatus?: string;
    receivedAt?: Date | null;
  },
) => {
  const [message] = await db
    .insert(supportEmailMessages)
    .values({
      cardId: input.cardId ?? null,
      source: input.source ?? "email",
      sourceEventId: input.sourceEventId,
      sourceCaseKey: input.sourceCaseKey ?? null,
      supportCaseId: input.supportCaseId ?? null,
      direction: input.direction,
      eventType:
        input.eventType ??
        (input.direction === "outbound" ? "outbound_email" : "inbound_email"),
      provider: input.provider ?? null,
      mailbox: input.mailbox ?? null,
      providerMessageId: input.providerMessageId ?? null,
      providerThreadId: input.providerThreadId ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      customerEmail: input.customerEmail ?? null,
      customerName: input.customerName ?? null,
      subject: input.subject ?? null,
      bodyText: input.bodyText ?? null,
      bodyHtml: input.bodyHtml ?? null,
      summary: input.summary ?? null,
      classification: input.classification ?? null,
      extraction: input.extraction ?? null,
      decision: input.decision ?? null,
      raw: input.raw ?? null,
      processingStatus: input.processingStatus ?? "received",
      receivedAt: input.receivedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [supportEmailMessages.source, supportEmailMessages.sourceEventId],
      set: {
        cardId: input.cardId ?? null,
        sourceCaseKey: input.sourceCaseKey ?? null,
        supportCaseId: input.supportCaseId ?? null,
        direction: input.direction,
        eventType:
          input.eventType ??
          (input.direction === "outbound" ? "outbound_email" : "inbound_email"),
        provider: input.provider ?? null,
        mailbox: input.mailbox ?? null,
        providerMessageId: input.providerMessageId ?? null,
        providerThreadId: input.providerThreadId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        customerEmail: input.customerEmail ?? null,
        customerName: input.customerName ?? null,
        subject: input.subject ?? null,
        bodyText: input.bodyText ?? null,
        bodyHtml: input.bodyHtml ?? null,
        summary: input.summary ?? null,
        classification: input.classification ?? null,
        extraction: input.extraction ?? null,
        decision: input.decision ?? null,
        raw: input.raw ?? null,
        processingStatus: input.processingStatus ?? "received",
        receivedAt: input.receivedAt ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return message;
};

export const attachEmailMessageToCard = async (
  db: dbClient,
  args: {
    source: string;
    sourceEventId: string;
    cardId: number;
    sourceCaseKey?: string | null;
    supportCaseId?: string | null;
    processingStatus?: string;
  },
) => {
  const [message] = await db
    .update(supportEmailMessages)
    .set({
      cardId: args.cardId,
      sourceCaseKey: args.sourceCaseKey ?? null,
      supportCaseId: args.supportCaseId ?? null,
      processingStatus: args.processingStatus ?? "linked",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(supportEmailMessages.source, args.source),
        eq(supportEmailMessages.sourceEventId, args.sourceEventId),
      ),
    )
    .returning();

  return message ?? null;
};

export const listMessagesForCard = async (
  db: dbClient,
  args: { cardId: number; limit?: number },
) =>
  db.query.supportEmailMessages.findMany({
    where: eq(supportEmailMessages.cardId, args.cardId),
    orderBy: [desc(supportEmailMessages.createdAt)],
    limit: args.limit ?? 10,
  });

export const listEventsForCard = async (
  db: dbClient,
  args: { cardId: number; limit?: number },
) =>
  db.query.supportTicketEvents.findMany({
    where: eq(supportTicketEvents.cardId, args.cardId),
    orderBy: [desc(supportTicketEvents.createdAt)],
    limit: args.limit ?? 10,
  });

export const listCandidateCases = async (
  db: dbClient,
  args: {
    emails: string[];
    issueCategory?: string | null;
    limit?: number;
  },
) => {
  const emails = args.emails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const where =
    emails.length > 0 && args.issueCategory
      ? or(
          inArray(supportTicketMetadata.email, emails),
          eq(supportTicketMetadata.issueCategory, args.issueCategory),
        )
      : emails.length > 0
        ? inArray(supportTicketMetadata.email, emails)
        : args.issueCategory
          ? eq(supportTicketMetadata.issueCategory, args.issueCategory)
          : undefined;

  const activeCardWhere = inArray(
    supportTicketMetadata.cardId,
    db.select({ id: cards.id }).from(cards).where(isNull(cards.deletedAt)),
  );

  return db.query.supportTicketMetadata.findMany({
    where: where ? and(where, activeCardWhere) : activeCardWhere,
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          cardNumber: true,
          title: true,
          description: true,
          createdBy: true,
          listId: true,
          updatedAt: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              publicId: true,
              name: true,
              boardId: true,
            },
          },
        },
      },
    },
    orderBy: [
      desc(supportTicketMetadata.updatedAt),
      desc(supportTicketMetadata.createdAt),
    ],
    limit: args.limit ?? 10,
  });
};

export const CARDLESS_RECORDED_PROCESSING_STATUSES = [
  "recorded_spam",
  "recorded_non_issue",
  "recorded_no_card",
] as const;

export const listOutboundEmailMessages = async (
  db: dbClient,
  args: { limit?: number } = {},
) =>
  db.query.supportEmailMessages.findMany({
    where: eq(supportEmailMessages.direction, "outbound"),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          title: true,
          deletedAt: true,
        },
      },
    },
    orderBy: [
      desc(supportEmailMessages.createdAt),
      desc(supportEmailMessages.id),
    ],
    limit: args.limit ?? 200,
  });

export const listCardlessEmailMessages = async (
  db: dbClient,
  args: { limit?: number; processingStatuses?: string[] } = {},
) =>
  db.query.supportEmailMessages.findMany({
    where: and(
      isNull(supportEmailMessages.cardId),
      inArray(
        supportEmailMessages.processingStatus,
        args.processingStatuses ?? [...CARDLESS_RECORDED_PROCESSING_STATUSES],
      ),
    ),
    orderBy: [
      desc(
        sql`coalesce(${supportEmailMessages.receivedAt}, ${supportEmailMessages.createdAt})`,
      ),
      desc(supportEmailMessages.id),
    ],
    limit: args.limit ?? 200,
  });

export const listByIssueCategory = async (
  db: dbClient,
  args: {
    workspaceId: number;
    issueCategory: string;
    limit?: number;
  },
) => {
  const workspaceCardIds = db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .where(
      and(eq(boards.workspaceId, args.workspaceId), isNull(cards.deletedAt)),
    );

  return db.query.supportTicketMetadata.findMany({
    where: and(
      eq(supportTicketMetadata.issueCategory, args.issueCategory),
      inArray(supportTicketMetadata.cardId, workspaceCardIds),
    ),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          cardNumber: true,
          title: true,
          listId: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              publicId: true,
              name: true,
              boardId: true,
            },
          },
        },
      },
    },
    orderBy: [
      desc(
        sql`coalesce(${supportTicketMetadata.reportedAt}, ${supportTicketMetadata.createdAt})`,
      ),
      desc(supportTicketMetadata.id),
    ],
    limit: args.limit ?? 200,
  });
};
