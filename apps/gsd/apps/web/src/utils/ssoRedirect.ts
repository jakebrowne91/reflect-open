import {
  GSD_CONTEXT_ADMIN,
  GSD_CONTEXT_QUERY_PARAM,
} from "@kan/auth/admin-context";

export function getSafeRedirectPath(
  rawNext: string | null,
  fallback: string,
): string {
  if (!rawNext?.startsWith("/")) return fallback;
  if (rawNext.startsWith("//")) return fallback;
  if (rawNext.startsWith("/api")) return fallback;
  if (rawNext.includes("://")) return fallback;
  return rawNext;
}

export function withAdminContextQuery(path: string): string {
  if (path.includes(`${GSD_CONTEXT_QUERY_PARAM}=`)) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${GSD_CONTEXT_QUERY_PARAM}=${GSD_CONTEXT_ADMIN}`;
}

export function withWorkspaceContextQuery(
  path: string,
  workspacePublicId: string,
): string {
  if (/[?&]workspacePublicId=/.test(path)) return path;
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    persistWorkspace: "false",
    workspacePublicId,
  });
  return `${path}${separator}${params.toString()}`;
}

/**
 * Every SSO redirect — not just the default board path — must pin the
 * embedded app to the support workspace via the workspacePublicId query
 * param. The iframe's partitioned localStorage can hold a stale or foreign
 * workspace id (or none at all, since the embed never persists one), and the
 * workspace provider falls back to an arbitrary membership when the param is
 * missing, leaving deep-linked pages like /feature-requests querying the
 * wrong workspace.
 */
export function buildSsoRedirectPath(args: {
  next: string | null;
  fallbackPath: string;
  workspacePublicId: string;
}): string {
  return withAdminContextQuery(
    withWorkspaceContextQuery(
      getSafeRedirectPath(args.next, args.fallbackPath),
      args.workspacePublicId,
    ),
  );
}
