/**
 * The support-email worker stores its full workflow output (classification,
 * extraction, reconciliation, agent notes) in the supportTicketMetadata
 * `metadata` jsonb blob. This flattens the fields the admin app surfaces,
 * tolerating missing or differently shaped sections from older tickets.
 */

export interface SupportWorkflowAssessment {
  category: string | null;
  component: string | null;
  urgency: string | null;
  confidence: string | null;
  summary: string | null;
  internalNote: string | null;
  needsEngineering: boolean | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

export function extractSupportWorkflowAssessment(
  metadata: unknown,
): SupportWorkflowAssessment {
  const blob = asRecord(metadata);
  const classification = asRecord(blob?.classification);
  const extracted = asRecord(blob?.extracted);
  const reconciliation = asRecord(blob?.reconciliation);
  const agent = asRecord(blob?.agent);

  return {
    category: firstString(classification?.category),
    component: firstString(
      reconciliation?.component,
      extracted?.affectedFeature,
    ),
    urgency: firstString(reconciliation?.priority, classification?.urgency),
    confidence: firstString(classification?.confidence),
    summary: firstString(
      reconciliation?.internalSummary,
      classification?.summary,
    ),
    internalNote: firstString(agent?.internalNote),
    needsEngineering: firstBoolean(reconciliation?.needsEngineering),
  };
}
