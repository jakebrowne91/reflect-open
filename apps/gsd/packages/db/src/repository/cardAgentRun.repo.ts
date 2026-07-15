import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  cardAgentRuns,
  cards,
  lists,
  supportTicketMetadata,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

export const create = async (
  db: dbClient,
  args: {
    cardId: number;
    createdBy: string;
    agent: string;
    prompt: string;
  },
) => {
  const [run] = await db
    .insert(cardAgentRuns)
    .values({
      publicId: generateUID(),
      cardId: args.cardId,
      createdBy: args.createdBy,
      agent: args.agent,
      prompt: args.prompt,
      status: "requested",
    })
    .returning();

  if (!run) throw new Error("Unable to create card agent run");

  return run;
};

export const markRunning = async (
  db: dbClient,
  args: {
    publicId: string;
    supersetWorkspaceId: string | null;
    supersetSessionId: string | null;
    supersetUrl: string | null;
    response: unknown;
  },
) => {
  const [run] = await db
    .update(cardAgentRuns)
    .set({
      status: "running",
      supersetWorkspaceId: args.supersetWorkspaceId,
      supersetSessionId: args.supersetSessionId,
      supersetUrl: args.supersetUrl,
      response: args.response,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(cardAgentRuns.publicId, args.publicId))
    .returning();

  if (!run) throw new Error("Unable to update card agent run");

  return run;
};

export const markFailed = async (
  db: dbClient,
  args: { publicId: string; error: string; response?: unknown },
) => {
  const [run] = await db
    .update(cardAgentRuns)
    .set({
      status: "failed",
      error: args.error,
      response: args.response,
      updatedAt: new Date(),
    })
    .where(eq(cardAgentRuns.publicId, args.publicId))
    .returning();

  if (!run) throw new Error("Unable to update card agent run");

  return run;
};

export const markNeedsInput = async (
  db: dbClient,
  args: { publicId: string; response: unknown },
) => {
  const [run] = await db
    .update(cardAgentRuns)
    .set({
      status: "needs_input",
      response: args.response,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(cardAgentRuns.publicId, args.publicId))
    .returning();

  if (!run) throw new Error("Unable to update card agent run");

  return run;
};

export const markReadyForReview = async (
  db: dbClient,
  args: { publicId: string; response: unknown },
) => {
  const [run] = await db
    .update(cardAgentRuns)
    .set({
      status: "ready_for_review",
      response: args.response,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(cardAgentRuns.publicId, args.publicId))
    .returning();

  if (!run) throw new Error("Unable to update card agent run");

  return run;
};

export const getByPublicId = (db: dbClient, publicId: string) => {
  return db.query.cardAgentRuns.findFirst({
    where: eq(cardAgentRuns.publicId, publicId),
  });
};

export const listByCardId = (db: dbClient, cardId: number) => {
  return db.query.cardAgentRuns.findMany({
    where: eq(cardAgentRuns.cardId, cardId),
    orderBy: desc(cardAgentRuns.createdAt),
  });
};

const KNOWN_ISSUE_LIST_NAMES = ["Resolved", "Ready for Review"];
const DEFAULT_KNOWN_ISSUE_WINDOW_DAYS = 14;
const DEFAULT_KNOWN_ISSUE_LIMIT = 10;

export interface RecentKnownIssue {
  cardPublicId: string;
  title: string;
  issueCategory: string | null;
  rootCause: string | null;
  fix: string | null;
  resolvedAt: Date | null;
}

/**
 * Cards recently moved to a Resolved / Ready for Review list, enriched with
 * the root cause and fix recorded in the latest agent run's
 * response.ticketUpdate JSONB. Surfaced to email triage and new agent runs as
 * "known issues" so recently solved problems are not re-derived from scratch.
 */
export const listRecentKnownIssues = async (
  db: dbClient,
  args?: { windowDays?: number; limit?: number; excludeCardId?: number },
): Promise<RecentKnownIssue[]> => {
  const windowDays = args?.windowDays ?? DEFAULT_KNOWN_ISSUE_WINDOW_DAYS;
  const resolvedSince = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const lastTouchedAt = sql`coalesce(${cards.updatedAt}, ${cards.createdAt})`;

  const rows = await db
    .select({
      cardId: cards.id,
      cardPublicId: cards.publicId,
      title: cards.title,
      issueCategory: supportTicketMetadata.issueCategory,
      resolvedAt: cards.updatedAt,
      createdAt: cards.createdAt,
    })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .leftJoin(supportTicketMetadata, eq(supportTicketMetadata.cardId, cards.id))
    .where(
      and(
        inArray(lists.name, KNOWN_ISSUE_LIST_NAMES),
        isNull(cards.deletedAt),
        sql`${lastTouchedAt} >= ${resolvedSince}`,
        args?.excludeCardId != null
          ? ne(cards.id, args.excludeCardId)
          : undefined,
      ),
    )
    .orderBy(desc(lastTouchedAt))
    .limit(args?.limit ?? DEFAULT_KNOWN_ISSUE_LIMIT);

  if (rows.length === 0) return [];

  const ticketUpdates = await db
    .select({
      cardId: cardAgentRuns.cardId,
      rootCause: sql<
        string | null
      >`${cardAgentRuns.response}->'ticketUpdate'->>'rootCause'`,
      fix: sql<
        string | null
      >`${cardAgentRuns.response}->'ticketUpdate'->>'fix'`,
    })
    .from(cardAgentRuns)
    .where(
      and(
        inArray(
          cardAgentRuns.cardId,
          rows.map((row) => row.cardId),
        ),
        sql`${cardAgentRuns.response}->'ticketUpdate' is not null`,
      ),
    )
    .orderBy(desc(cardAgentRuns.createdAt));

  const latestUpdateByCardId = new Map<
    number,
    { rootCause: string | null; fix: string | null }
  >();
  for (const update of ticketUpdates) {
    if (!latestUpdateByCardId.has(update.cardId)) {
      latestUpdateByCardId.set(update.cardId, update);
    }
  }

  return rows.map((row) => ({
    cardPublicId: row.cardPublicId,
    title: row.title,
    issueCategory: row.issueCategory ?? null,
    rootCause: latestUpdateByCardId.get(row.cardId)?.rootCause ?? null,
    fix: latestUpdateByCardId.get(row.cardId)?.fix ?? null,
    resolvedAt: row.resolvedAt ?? row.createdAt,
  }));
};

/**
 * Latest agent run whose recorded ticket update references the given PR URL.
 * The PR URL lives in the response JSONB (set by the agent callback); used by
 * the PR-merged webhook to find the card a merged PR belongs to.
 */
export const findLatestByPrUrl = (db: dbClient, prUrl: string) => {
  return db.query.cardAgentRuns.findFirst({
    where: sql`(${cardAgentRuns.response}->'ticketUpdate'->>'prUrl' = ${prUrl} OR ${cardAgentRuns.response}->>'prUrl' = ${prUrl})`,
    orderBy: desc(cardAgentRuns.createdAt),
    with: {
      card: {
        columns: { id: true, publicId: true, title: true, listId: true },
        with: {
          list: { columns: { id: true, name: true, boardId: true } },
        },
      },
    },
  });
};
