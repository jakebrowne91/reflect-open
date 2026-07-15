import type { NextApiRequest, NextApiResponse } from "next";
import { and, eq, isNull } from "drizzle-orm";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { closeDrizzleClient, createDrizzleClient } from "@kan/db/client";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";
import { workspaces } from "@kan/db/schema";

import { env } from "~/env";
import {
  DEFAULT_SUPPORT_WORKSPACE_SLUG,
  verifyRetrogradeAdminSsoToken,
} from "~/server/retrogradeAdminSso";
import { extractSupportWorkflowAssessment } from "~/server/supportWorkflowAssessment";

const MESSAGE_LIMIT = 20;

function getBearerToken(req: NextApiRequest): string | null {
  const value = req.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token ? token : null;
}

function getCardPublicId(req: NextApiRequest): string | null {
  const raw = req.query.cardPublicId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

/**
 * Detail view for one feature-request card, for the admin app's native
 * Feature Requests page. Same auth as the list endpoint: an admin-issued SSO
 * JWT signed with RETROGRADE_GSD_SSO_SECRET.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const secret = env.RETROGRADE_GSD_SSO_SECRET;
  if (!secret) {
    res
      .status(500)
      .json({ ok: false, error: "Retrograde GSD SSO is not configured" });
    return;
  }

  const token = getBearerToken(req);
  const payload = token ? verifyRetrogradeAdminSsoToken(token, secret) : null;
  if (!payload) {
    res.status(401).json({ ok: false, error: "Invalid or expired token" });
    return;
  }

  const cardPublicId = getCardPublicId(req);
  if (!cardPublicId) {
    res.status(400).json({ ok: false, error: "Missing cardPublicId" });
    return;
  }

  const db = createDrizzleClient();

  try {
    const metadata = await supportTicketMetadataRepo.getByCardPublicId(db, {
      cardPublicId,
    });

    if (!metadata) {
      res.status(404).json({ ok: false, error: "Feature request not found" });
      return;
    }

    const slug =
      env.RETROGRADE_SUPPORT_WORKSPACE_SLUG ?? DEFAULT_SUPPORT_WORKSPACE_SLUG;
    const workspace = await db.query.workspaces.findFirst({
      columns: { cardPrefix: true },
      where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)),
    });

    const messages = await supportTicketMetadataRepo.listMessagesForCard(db, {
      cardId: metadata.card.id,
      limit: MESSAGE_LIMIT,
    });

    res.status(200).json({
      ok: true,
      cardPrefix: workspace?.cardPrefix ?? null,
      featureRequest: {
        cardPublicId: metadata.card.publicId,
        cardNumber: metadata.card.cardNumber,
        title: metadata.card.title,
        listName: metadata.card.list.name,
        source: metadata.source,
        sourceSystem: metadata.sourceSystem,
        sourceChannel: metadata.sourceChannel,
        provider: metadata.provider,
        mailbox: metadata.mailbox,
        email: metadata.email,
        customerName: metadata.customerName,
        userId: metadata.userId,
        emmaUserId: metadata.emmaUserId,
        repoFullName: metadata.repoFullName,
        issueCategory: metadata.issueCategory,
        ariSessionUrl: metadata.ariSessionUrl,
        reportedAt: metadata.reportedAt,
        createdAt: metadata.createdAt,
        assessment: extractSupportWorkflowAssessment(metadata.metadata),
        messages: messages.map((message) => ({
          direction: message.direction,
          subject: message.subject,
          bodyText: message.bodyText,
          summary: message.summary,
          customerEmail: message.customerEmail,
          customerName: message.customerName,
          receivedAt: message.receivedAt,
          createdAt: message.createdAt,
        })),
      },
    });
  } finally {
    await closeDrizzleClient(db);
  }
}

export default withApiLogging(handler);
