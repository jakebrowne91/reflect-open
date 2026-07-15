type ReadyForReviewUpdate = {
  summary?: string | null;
  rootCause?: string | null;
  userImpact?: string | null;
  fix?: string | null;
  verification?: string | null;
  reviewNotes?: string | null;
  staffHandoff?: ReadyForReviewStaffHandoff | null;
  prUrl?: string | null;
  branch?: string | null;
};

type ReadyForReviewPayload = {
  summary?: string | null;
  answer?: string | null;
};

export type ReadyForReviewStaffHandoff = {
  whatAriFound: string;
  evidenceChecked: string;
  proposedNextStep: string;
  customerResponseRecommendation?: string | null;
};

const PLACEHOLDER_PATTERNS = [
  /^short\b/i,
  /^what happened$/i,
  /^customer\/user impact$/i,
  /^what changed or recommended action$/i,
  /^checks\/evidence$/i,
  /^what a human should review$/i,
  /^n\/a$/i,
  /^none$/i,
  /^todo$/i,
  /^tbd$/i,
];

const ACTION_PATTERNS = [
  /\bnext step\b/i,
  /\bproposed next step\b/i,
  /\baction\b/i,
  /\brunbook\b/i,
  /\breview\b/i,
  /\bconfirm\b/i,
  /\bdecide\b/i,
  /\bapprove\b/i,
  /\bapply\b/i,
  /\brun\b/i,
  /\bsend\b/i,
  /\bfix\b/i,
  /\bpr\b/i,
  /\bpull request\b/i,
  /\bmigration\b/i,
  /\bsql\b/i,
];

const EVIDENCE_PATTERNS = [
  /\bverified\b/i,
  /\bevidence\b/i,
  /\blog\b/i,
  /\bquery\b/i,
  /\bchecked\b/i,
  /\bconfirmed\b/i,
  /\bfound\b/i,
  /\btest\b/i,
  /\bscreenshot\b/i,
  /\bsession\b/i,
  /\bno .*found\b/i,
];

function usableText(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (text.length < 12) return "";
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) return "";
  return text;
}

function hasGithubPrUrl(value: string | null | undefined) {
  return Boolean(
    value?.match(/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i),
  );
}

export function isReadyForReviewStaffHandoff(
  value: unknown,
): value is ReadyForReviewStaffHandoff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    usableText(
      typeof record.whatAriFound === "string" ? record.whatAriFound : null,
    ) &&
    usableText(
      typeof record.evidenceChecked === "string"
        ? record.evidenceChecked
        : null,
    ) &&
    usableText(
      typeof record.proposedNextStep === "string"
        ? record.proposedNextStep
        : null,
    ),
  );
}

export function validateReadyForReviewHandoff(
  payload: ReadyForReviewPayload,
  update: ReadyForReviewUpdate,
): { ok: true } | { ok: false; error: string } {
  if (hasGithubPrUrl(update.prUrl)) return { ok: true };
  const staffHandoff = (
    update as ReadyForReviewUpdate & {
      staffHandoff?: unknown;
    }
  ).staffHandoff;
  if (isReadyForReviewStaffHandoff(staffHandoff)) return { ok: true };

  const combined = [
    update.summary,
    update.rootCause,
    update.userImpact,
    update.fix,
    update.verification,
    update.reviewNotes,
    payload.summary,
    payload.answer,
  ]
    .map(usableText)
    .filter(Boolean)
    .join("\n");

  const summary = usableText(update.summary) || usableText(payload.summary);
  const rootCause = usableText(update.rootCause);
  const impact = usableText(update.userImpact);
  const fix = usableText(update.fix);
  const verification = usableText(update.verification);
  const reviewNotes = usableText(update.reviewNotes);

  const hasAction =
    Boolean(fix || reviewNotes) ||
    ACTION_PATTERNS.some((pattern) => pattern.test(combined));
  const hasEvidence =
    Boolean(verification) ||
    EVIDENCE_PATTERNS.some((pattern) => pattern.test(combined));
  const supportingFields = [
    rootCause,
    impact,
    fix,
    verification,
    reviewNotes,
  ].filter(Boolean);
  const hasFinding =
    Boolean(rootCause) ||
    /\b(found|finding|root cause|cause)\b/i.test(combined);
  const hasProposedNextStep =
    Boolean(fix || reviewNotes) ||
    /\b(proposed next step|next step|recommend|recommended|should)\b/i.test(
      combined,
    );

  if (!summary) {
    return {
      ok: false,
      error:
        "Ready for review requires a concrete summary, PR, or reviewed action.",
    };
  }

  if (
    !hasFinding ||
    !hasProposedNextStep ||
    !hasAction ||
    !hasEvidence ||
    supportingFields.length < 2
  ) {
    return {
      ok: false,
      error:
        "Ready for review requires an explicit staff handoff: what Ari found, evidence, and the proposed next step.",
    };
  }

  return { ok: true };
}
