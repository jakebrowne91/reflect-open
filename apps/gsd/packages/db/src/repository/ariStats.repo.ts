import { sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  cardAgentRuns,
  supportEmailMessages,
  supportTicketEvents,
  supportTicketMetadata,
} from "@kan/db/schema";

export interface AriStats {
  sinceDays: number;
  cardsOpened: number;
  cardsResolved: number;
  prsOpened: number;
  runsStarted: number;
  runsFailed: number;
  emailsInbound: number;
  emailsOutbound: number;
  emailsSpam: number;
  featureRequests: number;
}

/**
 * Aggregate Ari activity over the trailing window. All counts are derived
 * from append-only rows (metadata createdAt, event rows, agent runs, email
 * messages), so re-running is idempotent and cheap.
 */
export const getAriStats = async (
  db: dbClient,
  input: { sinceDays?: number } = {},
): Promise<AriStats> => {
  const sinceDays =
    Number.isFinite(input.sinceDays) && (input.sinceDays ?? 0) > 0
      ? Math.min(input.sinceDays ?? 7, 90)
      : 7;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const result = await db.execute<{
    cards_opened: number;
    cards_resolved: number;
    prs_opened: number;
    runs_started: number;
    runs_failed: number;
    emails_inbound: number;
    emails_outbound: number;
    emails_spam: number;
    feature_requests: number;
  }>(sql`
    select
      (select count(*) from ${supportTicketMetadata}
        where ${supportTicketMetadata.createdAt} >= ${since}) as cards_opened,
      (select count(distinct ${supportTicketEvents.cardId}) from ${supportTicketEvents}
        where ${supportTicketEvents.status} = 'resolved'
          and ${supportTicketEvents.createdAt} >= ${since}) as cards_resolved,
      (select count(*) from ${cardAgentRuns}
        where ${cardAgentRuns.createdAt} >= ${since}
          and (${cardAgentRuns.response}->'ticketUpdate'->>'prUrl') is not null) as prs_opened,
      (select count(*) from ${cardAgentRuns}
        where ${cardAgentRuns.createdAt} >= ${since}) as runs_started,
      (select count(*) from ${cardAgentRuns}
        where ${cardAgentRuns.createdAt} >= ${since}
          and ${cardAgentRuns.status} = 'failed') as runs_failed,
      (select count(*) from ${supportEmailMessages}
        where ${supportEmailMessages.direction} = 'inbound'
          and ${supportEmailMessages.createdAt} >= ${since}) as emails_inbound,
      (select count(*) from ${supportEmailMessages}
        where ${supportEmailMessages.direction} = 'outbound'
          and ${supportEmailMessages.createdAt} >= ${since}) as emails_outbound,
      (select count(*) from ${supportEmailMessages}
        where ${supportEmailMessages.processingStatus} in ('recorded_spam', 'recorded_non_issue')
          and ${supportEmailMessages.createdAt} >= ${since}) as emails_spam,
      (select count(*) from ${supportTicketMetadata}
        where ${supportTicketMetadata.issueCategory} = 'feature_request'
          and ${supportTicketMetadata.createdAt} >= ${since}) as feature_requests
  `);

  const row: Partial<Record<string, unknown>> = result.rows[0] ?? {};
  const toNumber = (value: unknown) => Number(value ?? 0);

  return {
    sinceDays,
    cardsOpened: toNumber(row.cards_opened),
    cardsResolved: toNumber(row.cards_resolved),
    prsOpened: toNumber(row.prs_opened),
    runsStarted: toNumber(row.runs_started),
    runsFailed: toNumber(row.runs_failed),
    emailsInbound: toNumber(row.emails_inbound),
    emailsOutbound: toNumber(row.emails_outbound),
    emailsSpam: toNumber(row.emails_spam),
    featureRequests: toNumber(row.feature_requests),
  };
};
