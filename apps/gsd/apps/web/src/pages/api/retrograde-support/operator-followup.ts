import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { sendAriGoldFollowup } from "@kan/api/utils/ariGold";
import { createDrizzleClient } from "@kan/db/client";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardAgentRunRepo from "@kan/db/repository/cardAgentRun.repo";

import { env } from "~/env";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;

const operatorFollowupSchema = z.object({
  cardPublicId: z.string().trim().min(1).max(80),
  operatorUserId: z.string().trim().max(120).optional(),
  operatorName: z.string().trim().max(200).optional(),
  action: z.enum(["handle", "guide"]),
  guidance: z.string().trim().max(4000).optional(),
});

function getHeader(req: NextApiRequest, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifySignature(req: NextApiRequest, rawBody: string): boolean {
  const secret = env.RETROGRADE_GSD_API_SECRET;
  if (!secret) return false;

  const timestamp = getHeader(req, "x-retrograde-gsd-timestamp");
  const signature = getHeader(req, "x-retrograde-gsd-signature");
  if (!timestamp || !signature?.startsWith("sha256=")) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const timestampMs =
    timestampNumber > 1_000_000_000_000
      ? timestampNumber
      : timestampNumber * 1000;
  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_AGE_MS) return false;

  const actualHex = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(actualHex)) return false;

  const expectedHex = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function buildOperatorPrompt(input: z.infer<typeof operatorFollowupSchema>) {
  const operator =
    input.operatorName || input.operatorUserId || "Slack operator";
  const guidance =
    input.action === "guide" && input.guidance
      ? input.guidance
      : "You have operator approval to continue handling this support ticket yourself. Decide the next safest action, continue the investigation, and deal with the user through the existing support email workflow when appropriate.";

  return [
    `Operator follow-up for GSD card ${input.cardPublicId}.`,
    `Operator: ${operator}`,
    `Action: ${input.action}`,
    "",
    "Instructions:",
    guidance,
    "",
    "Use the existing GSD/support-email context. Do not create a duplicate ticket. If a customer-facing email is appropriate, use the established support email workflow and safety policy.",
  ].join("\n");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifySignature(req, rawBody)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ ok: false, error: "invalid json" });
    return;
  }

  const parsed = operatorFollowupSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.message });
    return;
  }

  const db = createDrizzleClient();
  const card = await cardRepo.getByPublicId(db, parsed.data.cardPublicId);
  if (!card) {
    res.status(404).json({ ok: false, error: "card not found" });
    return;
  }

  const [latestRun] = await cardAgentRunRepo.listByCardId(db, card.id);
  if (!latestRun?.supersetSessionId) {
    res
      .status(409)
      .json({ ok: false, error: "card has no active Ari session" });
    return;
  }

  const result = await sendAriGoldFollowup({
    eventId: `gsd-card:${card.publicId}:${latestRun.publicId}`,
    sessionId: latestRun.supersetSessionId,
    reply: buildOperatorPrompt(parsed.data),
  });

  res.status(200).json({
    ok: true,
    status: "queued",
    cardPublicId: card.publicId,
    runPublicId: latestRun.publicId,
    sessionId: result.sessionId ?? latestRun.supersetSessionId,
    sessionUrl: result.sessionUrl ?? latestRun.supersetUrl,
  });
}
