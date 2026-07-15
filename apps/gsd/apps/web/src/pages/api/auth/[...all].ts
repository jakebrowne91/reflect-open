import type { NextApiRequest, NextApiResponse } from "next";
import { toNodeHandler } from "better-auth/node";

import { withRateLimit } from "@kan/api/utils/rateLimit";
import {
  GSD_ADMIN_SESSION_COOKIE_NAME,
  GSD_ADMIN_SESSION_COOKIE_NAME_SECURE,
  GSD_CONTEXT_ADMIN,
  GSD_CONTEXT_HEADER,
  GSD_SESSION_COOKIE_NAME,
  GSD_SESSION_COOKIE_NAME_SECURE,
} from "@kan/auth/admin-context";
import { initAuth } from "@kan/auth/server";
import { closeDrizzleClient, createDrizzleClient } from "@kan/db/client";

export const config = { api: { bodyParser: false } };

const SESSION_COOKIE_NAMES = new Set([
  GSD_SESSION_COOKIE_NAME,
  GSD_SESSION_COOKIE_NAME_SECURE,
  GSD_ADMIN_SESSION_COOKIE_NAME,
  GSD_ADMIN_SESSION_COOKIE_NAME_SECURE,
  "kan.session_token",
  "__Secure-kan.session_token",
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
]);

function stripSessionCookies(cookieHeader: string | string[] | undefined) {
  const headerValue = Array.isArray(cookieHeader)
    ? cookieHeader.join("; ")
    : cookieHeader;

  if (!headerValue) return undefined;

  const cookies = headerValue
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .filter((cookie) => {
      const [name] = cookie.split("=");
      return name ? !SESSION_COOKIE_NAMES.has(name) : true;
    });

  return cookies.length > 0 ? cookies.join("; ") : undefined;
}

function shouldStripSessionCookies(req: NextApiRequest) {
  const route = Array.isArray(req.query.all)
    ? req.query.all.join("/")
    : typeof req.query.all === "string"
      ? req.query.all
      : (req.url ?? "");

  return (
    req.method === "POST" &&
    (route.startsWith("sign-in/") ||
      route.startsWith("sign-up/") ||
      route.includes("/sign-in/") ||
      route.includes("/sign-up/"))
  );
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Mirrors `applyAdminContextToHeaders` from @kan/auth/admin-context but
// operates on a NextApiRequest in place. We can't use the Headers version
// here because toNodeHandler reads cookies directly from req.headers.
function swapAdminCookieIntoSessionSlot(req: NextApiRequest) {
  if (getHeaderValue(req.headers[GSD_CONTEXT_HEADER]) !== GSD_CONTEXT_ADMIN) {
    return;
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return;

  const headerString = Array.isArray(cookieHeader)
    ? cookieHeader.join("; ")
    : cookieHeader;

  const cookies = headerString
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf("=");
      return eqIdx === -1
        ? { name: part, value: "" }
        : { name: part.slice(0, eqIdx), value: part.slice(eqIdx + 1) };
    });

  const adminCookie = cookies.find(
    (c) =>
      c.name === GSD_ADMIN_SESSION_COOKIE_NAME ||
      c.name === GSD_ADMIN_SESSION_COOKIE_NAME_SECURE,
  );
  if (!adminCookie) return;

  const targetName =
    adminCookie.name === GSD_ADMIN_SESSION_COOKIE_NAME_SECURE
      ? GSD_SESSION_COOKIE_NAME_SECURE
      : GSD_SESSION_COOKIE_NAME;

  const rewritten = cookies
    .filter(
      (c) =>
        c.name !== GSD_ADMIN_SESSION_COOKIE_NAME &&
        c.name !== GSD_ADMIN_SESSION_COOKIE_NAME_SECURE &&
        c.name !== GSD_SESSION_COOKIE_NAME &&
        c.name !== GSD_SESSION_COOKIE_NAME_SECURE,
    )
    .concat([{ name: targetName, value: adminCookie.value }]);

  req.headers.cookie = rewritten
    .map((c) => (c.value === "" ? c.name : `${c.name}=${c.value}`))
    .join("; ");
}

// When admin context, rewrite any outgoing Set-Cookie that targets the
// standard session-cookie name back to the admin name. Better-auth doesn't
// know about our cookie remap, so any refresh/rotation/sign-out it emits
// would otherwise overwrite a parallel direct-login session.
function wrapResponseForAdminCookieRewrite(res: NextApiResponse) {
  const remap = (cookieString: string): string => {
    const eqIdx = cookieString.indexOf("=");
    if (eqIdx === -1) return cookieString;
    const name = cookieString.slice(0, eqIdx);
    if (name === GSD_SESSION_COOKIE_NAME) {
      return `${GSD_ADMIN_SESSION_COOKIE_NAME}${cookieString.slice(eqIdx)}`;
    }
    if (name === GSD_SESSION_COOKIE_NAME_SECURE) {
      return `${GSD_ADMIN_SESSION_COOKIE_NAME_SECURE}${cookieString.slice(eqIdx)}`;
    }
    return cookieString;
  };

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) => {
    if (typeof name === "string" && name.toLowerCase() === "set-cookie") {
      const values = Array.isArray(value)
        ? value.map((v) => remap(String(v)))
        : [remap(String(value))];
      return originalSetHeader("set-cookie", values);
    }
    return originalSetHeader(name, value);
  }) as typeof res.setHeader;
}

export default withRateLimit(
  { points: 100, duration: 60 },
  async (req, res) => {
    /**
     * Better-auth behind proxies (Nginx/Cloudflare) can sometimes fail to parse the protocol
     * if headers are incorrectly set or if there are multiple values in X-Forwarded-Proto.
     * We sanitize these headers here to ensure better-auth gets a clean protocol and host.
     */
    const forwardedProto = req.headers["x-forwarded-proto"];
    if (forwardedProto) {
      const p = Array.isArray(forwardedProto)
        ? forwardedProto[0]
        : forwardedProto;
      req.headers["x-forwarded-proto"] = p?.split(",")[0]?.trim();
    }

    const forwardedHost = req.headers["x-forwarded-host"];
    if (forwardedHost) {
      const h = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
      req.headers["host"] = h?.split(",")[0]?.trim();
    }

    const isAdminContext =
      getHeaderValue(req.headers[GSD_CONTEXT_HEADER]) === GSD_CONTEXT_ADMIN;

    if (shouldStripSessionCookies(req)) {
      req.headers.cookie = stripSessionCookies(req.headers.cookie) ?? "";
    } else {
      // For non-sign-in/sign-up routes (e.g. get-session, sign-out), if the
      // request carries the admin-context header, swap the admin session
      // cookie into the slot better-auth actually reads from. Sign-in/sign-up
      // skip this because they don't depend on an existing session anyway.
      swapAdminCookieIntoSessionSlot(req);
    }

    if (isAdminContext) wrapResponseForAdminCookieRewrite(res);

    const db = createDrizzleClient();
    try {
      const handler = toNodeHandler(initAuth(db).handler);
      return await handler(req, res);
    } finally {
      await closeDrizzleClient(db);
    }
  },
);
