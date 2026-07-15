import { describe, expect, it } from "vitest";

import { validateReadyForReviewHandoff } from "./agentReviewHandoff";

describe("validateReadyForReviewHandoff", () => {
  it("rejects a sparse ready-for-review handoff", () => {
    const result = validateReadyForReviewHandoff(
      {
        summary:
          "Ticket needed: creator did not receive expected matches. Priority medium.",
      },
      {
        summary: "Ticket needed: creator did not receive expected matches.",
      },
    );

    expect(result).toEqual({
      ok: false,
      error:
        "Ready for review requires an explicit staff handoff: what Ari found, evidence, and the proposed next step.",
    });
  });

  it("accepts a handoff with findings, evidence, and a proposed next step", () => {
    const result = validateReadyForReviewHandoff(
      {},
      {
        summary:
          "Ari found the May 27 outreach run generated matches but did not notify the creator.",
        rootCause:
          "The outreach run was skipped as already profiling even though generated matches existed.",
        userImpact:
          "The creator did not receive the expected May 27 matches until the May 28 message.",
        fix: "Proposed next step: staff should confirm whether to send a creator apology and open an engineering follow-up for the already-profiling skip.",
        verification:
          "Checked production logs and found no WhatsApp delivery attempt or block for May 27.",
      },
    );

    expect(result).toEqual({ ok: true });
  });

  it("accepts the strict staffHandoff contract", () => {
    const result = validateReadyForReviewHandoff(
      {},
      {
        summary: "May 27 outreach delivery needs staff review.",
        staffHandoff: {
          whatAriFound:
            "Ari found matches were generated on May 27 but not delivered to the creator that day.",
          evidenceChecked:
            "Checked run state and delivery logs; no WhatsApp delivery attempt or block was found for May 27.",
          proposedNextStep:
            "Staff should approve a creator-facing apology and decide whether to open an engineering bug for the already-profiling skip.",
          customerResponseRecommendation:
            "Tell the creator the missed matches were included in the May 28 message and apologize for the delay.",
        },
      },
    );

    expect(result).toEqual({ ok: true });
  });

  it("accepts a pull request handoff", () => {
    const result = validateReadyForReviewHandoff(
      {},
      {
        prUrl: "https://github.com/CreatorComputeCompany/emma/pull/123",
      },
    );

    expect(result).toEqual({ ok: true });
  });
});
