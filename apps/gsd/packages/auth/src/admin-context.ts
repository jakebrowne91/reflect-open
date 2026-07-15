/// <reference lib="dom" />

/**
 * Admin SSO sessions and direct-login sessions share the same eTLD+1
 * (creatorcomputecompany.com), so the Partitioned cookie attribute does not
 * isolate them. To prevent the iframe's support-user session from clobbering
 * the user's direct-login session (and vice versa), the SSO flow writes its
 * session under a dedicated cookie name, and the iframe app marks its
 * requests with an `x-gsd-context: admin` header. The server-side helpers
 * here swap that admin cookie into the standard session-cookie slot before
 * better-auth reads it, so verification stays unchanged.
 */

const SESSION_COOKIE_BASE_NAME = "gsd.session_token";
const ADMIN_SESSION_COOKIE_BASE_NAME = "gsd-admin.session_token";

export const GSD_SESSION_COOKIE_NAME = SESSION_COOKIE_BASE_NAME;
export const GSD_SESSION_COOKIE_NAME_SECURE = `__Secure-${SESSION_COOKIE_BASE_NAME}`;
export const GSD_ADMIN_SESSION_COOKIE_NAME = ADMIN_SESSION_COOKIE_BASE_NAME;
export const GSD_ADMIN_SESSION_COOKIE_NAME_SECURE = `__Secure-${ADMIN_SESSION_COOKIE_BASE_NAME}`;

export const GSD_CONTEXT_HEADER = "x-gsd-context";
export const GSD_CONTEXT_ADMIN = "admin";
export const GSD_CONTEXT_QUERY_PARAM = "gsd_context";
export const GSD_CONTEXT_SESSION_STORAGE_KEY = "gsd:context";

const GSD_ADMIN_COOKIE_NAMES = new Set<string>([
  GSD_ADMIN_SESSION_COOKIE_NAME,
  GSD_ADMIN_SESSION_COOKIE_NAME_SECURE,
]);

const GSD_SESSION_COOKIE_NAMES = new Set<string>([
  GSD_SESSION_COOKIE_NAME,
  GSD_SESSION_COOKIE_NAME_SECURE,
]);

function parseCookieString(
  cookieHeader: string,
): { name: string; value: string }[] {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return { name: part, value: "" };
      return { name: part.slice(0, eqIdx), value: part.slice(eqIdx + 1) };
    });
}

function serializeCookies(
  cookies: { name: string; value: string }[],
): string {
  return cookies.map((c) => (c.value === "" ? c.name : `${c.name}=${c.value}`)).join("; ");
}

/**
 * If the request signals admin context AND carries an admin session cookie,
 * return a new Headers with the admin cookie renamed into the standard
 * session-cookie slot. The original admin cookie is removed and any
 * existing standard session cookie is dropped, so better-auth reads the
 * admin session regardless of what a direct-login cookie may also be
 * carrying.
 *
 * If not admin-context, headers are returned unchanged.
 */
export function applyAdminContextToHeaders(headers: Headers): Headers {
  const context = headers.get(GSD_CONTEXT_HEADER);
  if (context !== GSD_CONTEXT_ADMIN) return headers;

  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return headers;

  const cookies = parseCookieString(cookieHeader);
  const adminCookie = cookies.find((c) => GSD_ADMIN_COOKIE_NAMES.has(c.name));
  if (!adminCookie) return headers;

  // Determine which standard-session name the admin value should be remapped
  // to. Mirror the secure/insecure variant of the admin cookie so attribute
  // assumptions downstream (e.g. better-auth's __Secure- preference) hold.
  const targetName =
    adminCookie.name === GSD_ADMIN_SESSION_COOKIE_NAME_SECURE
      ? GSD_SESSION_COOKIE_NAME_SECURE
      : GSD_SESSION_COOKIE_NAME;

  const remapped = cookies
    .filter(
      (c) => !GSD_ADMIN_COOKIE_NAMES.has(c.name) && !GSD_SESSION_COOKIE_NAMES.has(c.name),
    )
    .concat([{ name: targetName, value: adminCookie.value }]);

  const next = new Headers(headers);
  next.set("cookie", serializeCookies(remapped));
  return next;
}

/**
 * Browser-side: returns true when this tab is running the admin iframe
 * flow. Checks the URL query first (set by the SSO redirect) and persists
 * the result into sessionStorage so subsequent in-iframe navigations stay
 * recognised even after the query param is stripped.
 */
export function isGsdAdminContext(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(GSD_CONTEXT_QUERY_PARAM) === GSD_CONTEXT_ADMIN) {
      window.sessionStorage.setItem(
        GSD_CONTEXT_SESSION_STORAGE_KEY,
        GSD_CONTEXT_ADMIN,
      );
      return true;
    }

    return (
      window.sessionStorage.getItem(GSD_CONTEXT_SESSION_STORAGE_KEY) ===
      GSD_CONTEXT_ADMIN
    );
  } catch {
    return false;
  }
}
