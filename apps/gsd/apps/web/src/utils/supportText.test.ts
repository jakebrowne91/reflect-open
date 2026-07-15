import { describe, expect, it } from "vitest";

import {
  cleanSupportText,
  cleanSupportTitle,
  getCardDescriptionPreview,
} from "./supportText";

describe("support text formatting", () => {
  it("renders Slack mrkdwn links as readable text", () => {
    expect(
      cleanSupportText(
        "<mailto:jake@jakebrowne.ie|jake@jakebrowne.ie> can't access his account",
      ),
    ).toBe("jake@jakebrowne.ie can't access his account");
  });

  it("cleans Slack support card titles", () => {
    expect(
      cleanSupportTitle(
        "Slack support: <mailto:jake@jakebrowne.ie|jake@jakebrowne.ie> can't access his account",
      ),
    ).toBe("Slack: jake@jakebrowne.ie can't access his account");
  });

  it("uses the support summary instead of hard parameters for board previews", () => {
    expect(
      getCardDescriptionPreview(`## Hard Parameters

- Event ID: slack-support:C123:1778941800.000000:session-123
- User ID: U123

## Summary

<mailto:jake@jakebrowne.ie|jake@jakebrowne.ie> can't access his account

## Customer

- Name: U123`),
    ).toBe("jake@jakebrowne.ie can't access his account");
  });
});
