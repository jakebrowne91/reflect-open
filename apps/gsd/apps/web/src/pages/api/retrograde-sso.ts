import { createHmac } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { and, eq, isNull, or } from "drizzle-orm";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { SUPPORT_LIST_NAMES } from "@kan/api/utils/retrogradeSupport";
import {
  GSD_ADMIN_SESSION_COOKIE_NAME,
  GSD_ADMIN_SESSION_COOKIE_NAME_SECURE,
} from "@kan/auth/admin-context";
import { initAuth } from "@kan/auth/server";
import { closeDrizzleClient, createDrizzleClient } from "@kan/db/client";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as memberRepo from "@kan/db/repository/member.repo";
import * as permissionRepo from "@kan/db/repository/permission.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import {
  boards,
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

import { env } from "~/env";
import {
  DEFAULT_SUPPORT_WORKSPACE_SLUG,
  verifyRetrogradeAdminSsoToken,
} from "~/server/retrogradeAdminSso";
import { buildSsoRedirectPath } from "~/utils/ssoRedirect";

const DEFAULT_WORKSPACE_SLUG = DEFAULT_SUPPORT_WORKSPACE_SLUG;
const DEFAULT_WORKSPACE_NAME = "Creator Compute Company Support";
const DEFAULT_BOARD_SLUG = "customer-support";
const DEFAULT_BOARD_NAME = "Customer Support";
const DEFAULT_LIST_NAMES = SUPPORT_LIST_NAMES;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
// Cookies older SSO implementations may have set under the shared session-cookie
// name. We clear these (in partitioned form only — see comment below) on every
// SSO start so a stale value doesn't keep the iframe authed as a previous user.
const LEGACY_SESSION_COOKIE_NAMES = [
  "kan.session_token",
  "__Secure-kan.session_token",
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];
const ADMIN_SESSION_COOKIE_NAMES = [
  GSD_ADMIN_SESSION_COOKIE_NAME,
  GSD_ADMIN_SESSION_COOKIE_NAME_SECURE,
];

type DbClient = ReturnType<typeof createDrizzleClient>;

interface KanUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

interface WorkspaceRecord {
  id: number;
  publicId: string;
  name: string;
  slug: string;
}

interface BoardRecord {
  id: number;
  publicId: string;
  name: string;
  slug: string;
}

function getStringQueryParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

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
      return name ? !LEGACY_SESSION_COOKIE_NAMES.includes(name) : true;
    });

  return cookies.length > 0 ? cookies.join("; ") : undefined;
}

function getDisplayName(email: string): string {
  const localPart = email.split("@")[0];
  const displayPart = localPart && localPart.length > 0 ? localPart : email;
  const words = displayPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean);

  return words.length
    ? words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : email;
}

async function findUserByEmail(
  db: DbClient,
  email: string,
): Promise<KanUser | null> {
  const user = await db.query.users.findFirst({
    columns: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
    },
    where: eq(users.email, email),
  });

  return user ?? null;
}

async function ensureUser(db: DbClient, email: string): Promise<KanUser> {
  const existingUser = await findUserByEmail(db, email);
  if (existingUser) return existingUser;

  const [createdUser] = await db
    .insert(users)
    .values({
      email,
      name: getDisplayName(email),
      emailVerified: true,
    })
    .onConflictDoNothing()
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
    });

  const user = createdUser ?? (await findUserByEmail(db, email));
  if (!user) throw new Error(`Failed to create Retrograde SSO user ${email}`);

  return user;
}

async function findWorkspaceBySlug(
  db: DbClient,
  slug: string,
): Promise<WorkspaceRecord | null> {
  const workspace = await db.query.workspaces.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      slug: true,
    },
    where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)),
  });

  return workspace ?? null;
}

async function ensureWorkspace(
  db: DbClient,
  user: KanUser,
): Promise<WorkspaceRecord> {
  const slug = env.RETROGRADE_SUPPORT_WORKSPACE_SLUG ?? DEFAULT_WORKSPACE_SLUG;
  const name = env.RETROGRADE_SUPPORT_WORKSPACE_NAME ?? DEFAULT_WORKSPACE_NAME;

  const existingWorkspace = await findWorkspaceBySlug(db, slug);
  if (existingWorkspace) return existingWorkspace;

  await workspaceRepo
    .create(db, {
      name,
      slug,
      createdBy: user.id,
      createdByEmail: user.email,
      description: "Retrograde customer support workspace",
      plan: "team",
    })
    .catch(async (error) => {
      const workspace = await findWorkspaceBySlug(db, slug);
      if (workspace) return;
      throw error;
    });

  const workspace = await findWorkspaceBySlug(db, slug);
  if (!workspace) throw new Error(`Failed to create workspace ${slug}`);

  return workspace;
}

async function findBoardBySlug(
  db: DbClient,
  workspaceId: number,
  slug: string,
): Promise<BoardRecord | null> {
  const board = await db.query.boards.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      slug: true,
    },
    where: and(
      eq(boards.workspaceId, workspaceId),
      eq(boards.slug, slug),
      isNull(boards.deletedAt),
    ),
  });

  return board ?? null;
}

async function ensureBoard(
  db: DbClient,
  user: KanUser,
  workspace: WorkspaceRecord,
): Promise<BoardRecord> {
  const slug = env.RETROGRADE_SUPPORT_BOARD_SLUG ?? DEFAULT_BOARD_SLUG;
  const name = env.RETROGRADE_SUPPORT_BOARD_NAME ?? DEFAULT_BOARD_NAME;

  const existingBoard = await findBoardBySlug(db, workspace.id, slug);
  if (existingBoard) return existingBoard;

  await boardRepo
    .create(db, {
      name,
      slug,
      createdBy: user.id,
      workspaceId: workspace.id,
    })
    .catch(async (error) => {
      const board = await findBoardBySlug(db, workspace.id, slug);
      if (board) return;
      throw error;
    });

  const board = await findBoardBySlug(db, workspace.id, slug);
  if (!board) throw new Error(`Failed to create board ${slug}`);

  return board;
}

async function ensureLists(db: DbClient, user: KanUser, board: BoardRecord) {
  const existingLists = await db.query.lists.findMany({
    columns: {
      name: true,
    },
    where: and(eq(lists.boardId, board.id), isNull(lists.deletedAt)),
  });
  const existingNames = new Set(existingLists.map((list) => list.name));

  for (const name of DEFAULT_LIST_NAMES) {
    if (!existingNames.has(name)) {
      await listRepo.create(db, {
        name,
        createdBy: user.id,
        boardId: board.id,
      });
    }
  }
}

async function ensureWorkspaceMembership(
  db: DbClient,
  user: KanUser,
  workspace: WorkspaceRecord,
) {
  const adminRole = await permissionRepo.getRoleByWorkspaceIdAndName(
    db,
    workspace.id,
    "admin",
  );
  const existingMember = await db.query.workspaceMembers.findFirst({
    columns: {
      id: true,
      status: true,
      userId: true,
      role: true,
      roleId: true,
    },
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      isNull(workspaceMembers.deletedAt),
      or(
        eq(workspaceMembers.email, user.email),
        eq(workspaceMembers.userId, user.id),
      ),
    ),
  });

  if (existingMember) {
    if (
      existingMember.status !== "active" ||
      existingMember.userId !== user.id ||
      existingMember.role !== "admin" ||
      existingMember.roleId !== (adminRole?.id ?? null)
    ) {
      await db
        .update(workspaceMembers)
        .set({
          userId: user.id,
          email: user.email,
          role: "admin",
          roleId: adminRole?.id ?? null,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(workspaceMembers.id, existingMember.id));
    }

    return;
  }

  await memberRepo.create(db, {
    userId: user.id,
    email: user.email,
    workspaceId: workspace.id,
    createdBy: user.id,
    role: "admin",
    roleId: adminRole?.id ?? null,
    status: "active",
  });
}

function signBetterAuthCookieValue(
  value: string,
  secret: string | Uint8Array,
): string {
  const key = typeof secret === "string" ? secret : Buffer.from(secret);
  const signature = createHmac("sha256", key).update(value).digest("base64");

  return encodeURIComponent(`${value}.${signature}`);
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    domain?: string;
    path?: string;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    partitioned?: boolean;
  },
) {
  const parts = [`${name}=${value}`];

  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    parts.push(
      `SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`,
    );
  }
  if (options.partitioned) parts.push("Partitioned");

  return parts.join("; ");
}

function serializeExpiredSessionCookie(
  name: string,
  options: {
    domain?: string;
    path?: string;
    secure?: boolean;
    sameSite?: string;
    partitioned?: boolean;
  },
) {
  return serializeCookie(name, "", {
    ...options,
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
  });
}

function createExpiredSessionCookies(
  names: string[],
  options: {
    domain?: string;
    path?: string;
    secure?: boolean;
    sameSite?: string;
    partitioned?: boolean;
  },
) {
  return names.map((name) => serializeExpiredSessionCookie(name, options));
}

function isSecureRequest(req: NextApiRequest): boolean {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;

  if (protocol?.split(",")[0]?.trim() === "https") return true;

  const host = req.headers.host ?? "";
  return !host.startsWith("localhost:") && !host.startsWith("127.0.0.1:");
}

function getHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getClientIp(req: NextApiRequest): string {
  const forwardedIp = getHeaderValue(req.headers["x-forwarded-for"])
    ?.split(",")[0]
    ?.trim();
  const cloudflareIp = getHeaderValue(req.headers["cf-connecting-ip"])?.trim();
  const realIp = getHeaderValue(req.headers["x-real-ip"])?.trim();

  return forwardedIp ?? cloudflareIp ?? realIp ?? "";
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = env.RETROGRADE_GSD_SSO_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Retrograde GSD SSO is not configured" });
    return;
  }

  const token = getStringQueryParam(req.query.token);
  const payload = token ? verifyRetrogradeAdminSsoToken(token, secret) : null;

  if (!payload) {
    res.status(401).json({ error: "Invalid or expired SSO token" });
    return;
  }

  const db = createDrizzleClient();

  try {
    req.headers.cookie = stripSessionCookies(req.headers.cookie) ?? "";

    const user = await ensureUser(db, payload.email);
    const workspace = await ensureWorkspace(db, user);
    const board = await ensureBoard(db, user, workspace);

    await ensureLists(db, user, board);
    await ensureWorkspaceMembership(db, user, workspace);

    const auth = initAuth(db);
    const authContext = await auth.$context;
    const session = (await authContext.internalAdapter.createSession(
      user.id,
      false,
      {
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] ?? "",
      },
    )) as { token: string } | null;

    if (!session) {
      throw new Error(`Failed to create SSO session for ${user.email}`);
    }

    const cookie = authContext.authCookies.sessionToken;
    const cookieValue = signBetterAuthCookieValue(
      session.token,
      authContext.secret,
    );
    const secureRequest = isSecureRequest(req);
    const adminCookieName = secureRequest
      ? GSD_ADMIN_SESSION_COOKIE_NAME_SECURE
      : GSD_ADMIN_SESSION_COOKIE_NAME;
    const setCookie = serializeCookie(adminCookieName, cookieValue, {
      ...cookie.options,
      maxAge: cookie.options.maxAge ?? SESSION_MAX_AGE_SECONDS,
      secure: secureRequest,
      sameSite: secureRequest ? "none" : "lax",
      partitioned: secureRequest,
    });

    const cookiePath = cookie.options.path ?? "/";
    // Clear stale admin cookies (both partitioned and non-partitioned variants)
    // before writing the fresh one. Crucially, we do NOT touch
    // `__Secure-gsd.session_token`/`gsd.session_token` here — that cookie
    // belongs to the direct-login flow at gsd.creatorcomputecompany.com/login
    // and must survive an SSO start so the user stays signed in on their
    // direct tab.
    const clearAdminCookies = createExpiredSessionCookies(
      ADMIN_SESSION_COOKIE_NAMES,
      {
        domain: cookie.options.domain,
        path: cookiePath,
        secure: secureRequest,
        sameSite: secureRequest ? "none" : "lax",
      },
    );
    // Legacy / migration-cleanup clears. These run partitioned-only so they
    // can't destroy a direct-login session set in non-partitioned form. We
    // include `cookie.name` (the standard better-auth name) here because
    // pre-fix versions of this endpoint wrote partitioned cookies under that
    // name; users may still be holding stale ones.
    const clearLegacyPartitionedCookies = secureRequest
      ? createExpiredSessionCookies(
          Array.from(
            new Set([
              cookie.name,
              ...ADMIN_SESSION_COOKIE_NAMES,
              ...LEGACY_SESSION_COOKIE_NAMES,
            ]),
          ),
          {
            domain: cookie.options.domain,
            path: cookiePath,
            secure: true,
            sameSite: "none",
            partitioned: true,
          },
        )
      : [];

    const sessionCookies = [
      ...clearAdminCookies,
      ...clearLegacyPartitionedCookies,
      setCookie,
    ];

    res.setHeader("Set-Cookie", sessionCookies);
    res.redirect(
      302,
      buildSsoRedirectPath({
        next: getStringQueryParam(req.query.next),
        fallbackPath: `/boards/${board.publicId}`,
        workspacePublicId: workspace.publicId,
      }),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to start Retrograde GSD session" });
  } finally {
    await closeDrizzleClient(db);
  }
}

export default withApiLogging(handler);
