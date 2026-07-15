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

const FEATURE_REQUEST_ISSUE_CATEGORY = "feature_request";
const MAX_LIMIT = 200;

function getBearerToken(req: NextApiRequest): string | null {
  const value = req.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token ? token : null;
}

function getLimit(req: NextApiRequest): number {
  const raw = req.query.limit;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(value) || value < 1) return MAX_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

/**
 * Read endpoint for the Retrograde admin app's native Feature Requests page.
 * Authenticated with the same admin-issued SSO JWT used by /api/retrograde-sso
 * (signed with RETROGRADE_GSD_SSO_SECRET) — the admin API holds that secret
 * but not RETROGRADE_GSD_API_SECRET, which is reserved for the ari-gold
 * worker integrations.
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

  const db = createDrizzleClient();

  try {
    const slug =
      env.RETROGRADE_SUPPORT_WORKSPACE_SLUG ?? DEFAULT_SUPPORT_WORKSPACE_SLUG;
    const workspace = await db.query.workspaces.findFirst({
      columns: { id: true, publicId: true, cardPrefix: true },
      where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)),
    });

    if (!workspace) {
      res.status(200).json({ ok: true, cardPrefix: null, featureRequests: [] });
      return;
    }

    const featureRequests = await supportTicketMetadataRepo.listByIssueCategory(
      db,
      {
        workspaceId: workspace.id,
        issueCategory: FEATURE_REQUEST_ISSUE_CATEGORY,
        limit: getLimit(req),
      },
    );

    res.status(200).json({
      ok: true,
      cardPrefix: workspace.cardPrefix,
      featureRequests: featureRequests.map((metadata) => {
        const assessment = extractSupportWorkflowAssessment(metadata.metadata);
        return {
          cardPublicId: metadata.card.publicId,
          cardNumber: metadata.card.cardNumber,
          title: metadata.card.title,
          listName: metadata.card.list.name,
          source: metadata.source,
          sourceSystem: metadata.sourceSystem,
          sourceChannel: metadata.sourceChannel,
          email: metadata.email,
          customerName: metadata.customerName,
          repoFullName: metadata.repoFullName,
          component: assessment.component,
          urgency: assessment.urgency,
          summary: assessment.summary,
          reportedAt: metadata.reportedAt,
          createdAt: metadata.createdAt,
        };
      }),
    });
  } finally {
    await closeDrizzleClient(db);
  }
}

export default withApiLogging(handler);
