import { describe, expect, it } from "vitest";

import {
  buildSsoRedirectPath,
  getSafeRedirectPath,
  withAdminContextQuery,
  withWorkspaceContextQuery,
} from "./ssoRedirect";

const WORKSPACE_ID = "ws1234567890";

describe("getSafeRedirectPath", () => {
  it("returns the fallback when next is missing", () => {
    expect(getSafeRedirectPath(null, "/boards/abc")).toBe("/boards/abc");
  });

  it.each([
    "https://evil.example.com",
    "//evil.example.com",
    "/api/retrograde-sso",
    "/foo/https://evil.example.com",
    "relative-path",
  ])("rejects unsafe next value %s", (next) => {
    expect(getSafeRedirectPath(next, "/boards/abc")).toBe("/boards/abc");
  });

  it("accepts a safe absolute path", () => {
    expect(getSafeRedirectPath("/feature-requests", "/boards/abc")).toBe(
      "/feature-requests",
    );
  });
});

describe("withAdminContextQuery", () => {
  it("appends the admin context param", () => {
    expect(withAdminContextQuery("/feature-requests")).toBe(
      "/feature-requests?gsd_context=admin",
    );
  });

  it("uses & when the path already has a query", () => {
    expect(withAdminContextQuery("/feature-requests?foo=1")).toBe(
      "/feature-requests?foo=1&gsd_context=admin",
    );
  });

  it("does not duplicate an existing context param", () => {
    expect(withAdminContextQuery("/foo?gsd_context=admin")).toBe(
      "/foo?gsd_context=admin",
    );
  });
});

describe("withWorkspaceContextQuery", () => {
  it("appends persistWorkspace=false and the workspace id", () => {
    expect(withWorkspaceContextQuery("/feature-requests", WORKSPACE_ID)).toBe(
      `/feature-requests?persistWorkspace=false&workspacePublicId=${WORKSPACE_ID}`,
    );
  });

  it("uses & when the path already has a query", () => {
    expect(
      withWorkspaceContextQuery("/feature-requests?foo=1", WORKSPACE_ID),
    ).toBe(
      `/feature-requests?foo=1&persistWorkspace=false&workspacePublicId=${WORKSPACE_ID}`,
    );
  });

  it("does not duplicate an existing workspace param", () => {
    const path = `/boards/abc?workspacePublicId=${WORKSPACE_ID}`;
    expect(withWorkspaceContextQuery(path, "other-workspace")).toBe(path);
  });
});

describe("buildSsoRedirectPath", () => {
  it("pins deep links to the support workspace", () => {
    expect(
      buildSsoRedirectPath({
        next: "/feature-requests",
        fallbackPath: "/boards/abc",
        workspacePublicId: WORKSPACE_ID,
      }),
    ).toBe(
      `/feature-requests?persistWorkspace=false&workspacePublicId=${WORKSPACE_ID}&gsd_context=admin`,
    );
  });

  it("pins the default board redirect to the support workspace", () => {
    expect(
      buildSsoRedirectPath({
        next: null,
        fallbackPath: "/boards/abc",
        workspacePublicId: WORKSPACE_ID,
      }),
    ).toBe(
      `/boards/abc?persistWorkspace=false&workspacePublicId=${WORKSPACE_ID}&gsd_context=admin`,
    );
  });

  it("falls back to the board path when next is unsafe", () => {
    expect(
      buildSsoRedirectPath({
        next: "//evil.example.com",
        fallbackPath: "/boards/abc",
        workspacePublicId: WORKSPACE_ID,
      }),
    ).toBe(
      `/boards/abc?persistWorkspace=false&workspacePublicId=${WORKSPACE_ID}&gsd_context=admin`,
    );
  });
});
