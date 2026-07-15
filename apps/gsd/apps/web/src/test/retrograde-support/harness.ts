/**
 * Test harness for the Next pages API handlers in
 * src/pages/api/retrograde-support/.
 *
 * Tests live outside src/pages so Next never treats them as routes. The
 * handlers are driven directly as `(req, res)` functions with:
 *  - an isolated in-memory PGlite database per test (migrations applied),
 *    returned by the mocked `@kan/db/client#createDrizzleClient`
 *  - a minimal async-iterable fake request carrying the raw JSON body and
 *    HMAC signature headers (handlers disable bodyParser and read the raw
 *    stream themselves)
 *  - a fake response capturing status/json
 */
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PgTable } from "drizzle-orm/pg-core";
import type { NextApiRequest, NextApiResponse } from "next";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { dbClient } from "@kan/db/client";
import * as schema from "@kan/db/schema";

export const TEST_GSD_API_SECRET = "test-gsd-api-secret";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../../../packages/db/migrations", import.meta.url),
);

/** Fresh in-memory PGlite database with all migrations applied. */
export async function createTestDb(): Promise<dbClient> {
  const client = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as dbClient;
}

let currentDb: dbClient | null = null;

/** Registers the database the mocked createDrizzleClient() should return. */
export function setTestDb(db: dbClient | null) {
  currentDb = db;
}

export function getTestDb(): dbClient {
  if (!currentDb) {
    throw new Error("Test database not initialised — call setTestDb first");
  }
  return currentDb;
}

export function signGsdRequest(
  body: string,
  options?: { secret?: string; timestampSeconds?: number },
) {
  const timestamp = String(
    options?.timestampSeconds ?? Math.floor(Date.now() / 1000),
  );
  const signature = createHmac("sha256", options?.secret ?? TEST_GSD_API_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  return { timestamp, signature: `sha256=${signature}` };
}

export function makeRequest(args: {
  body: string;
  method?: string;
  headers?: Record<string, string>;
}): NextApiRequest {
  const headers: Record<string, string> = { host: "gsd.test" };
  for (const [name, value] of Object.entries(args.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }

  const req = {
    method: args.method ?? "POST",
    url: "/api/retrograde-support/test",
    query: {},
    headers,
    async *[Symbol.asyncIterator]() {
      yield await Promise.resolve(Buffer.from(args.body, "utf8"));
    },
  };

  return req as unknown as NextApiRequest;
}

/** Signed POST request the handlers' verifySignature() accepts. */
export function makeSignedRequest(
  payload: unknown,
  options?: {
    secret?: string;
    timestampSeconds?: number;
    headers?: Record<string, string>;
  },
): NextApiRequest {
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signGsdRequest(body, options);

  return makeRequest({
    body,
    headers: {
      "x-retrograde-gsd-timestamp": timestamp,
      "x-retrograde-gsd-signature": signature,
      ...options?.headers,
    },
  });
}

export interface TestResponse {
  statusCode: number;
  headersSent: boolean;
  headers: Record<string, unknown>;
  /** Body passed to res.json(), if any. */
  jsonBody: unknown;
  /** res.json() body, asserted as a plain object for property access. */
  body(): Record<string, unknown>;
}

export function makeResponse(): NextApiResponse & TestResponse {
  const res = {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, unknown>,
    jsonBody: undefined as unknown,
    setHeader(name: string, value: unknown) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.jsonBody = payload;
      res.headersSent = true;
      return res;
    },
    end() {
      res.headersSent = true;
      return res;
    },
    body(): Record<string, unknown> {
      if (
        res.jsonBody === null ||
        typeof res.jsonBody !== "object" ||
        Array.isArray(res.jsonBody)
      ) {
        throw new Error(
          `Response body is not an object: ${String(res.jsonBody)}`,
        );
      }
      return res.jsonBody as Record<string, unknown>;
    },
  };

  return res as unknown as NextApiResponse & TestResponse;
}

let publicIdCounter = 0;

/** Unique 12-char publicId matching the varchar(12) columns. */
export function testPublicId(prefix: string): string {
  publicIdCounter += 1;
  return `${prefix}${String(publicIdCounter).padStart(12 - prefix.length, "0")}`;
}

export const SUPPORT_BOT_EMAIL = "support-agent@getretrograde.ai";

/** Seeds a user + workspace + board with the given lists, for handlers that
 * don't bootstrap their own board (e.g. pr-merged). */
export async function seedBoard(
  db: dbClient,
  args: { listNames: string[]; userEmail?: string },
) {
  const [user] = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      name: "Support Agent",
      email: args.userEmail ?? SUPPORT_BOT_EMAIL,
      emailVerified: true,
    })
    .returning();
  if (!user) throw new Error("Failed to seed user");

  const [workspace] = await db
    .insert(schema.workspaces)
    .values({
      publicId: testPublicId("ws"),
      name: "Test Support Workspace",
      slug: `support-${publicIdCounter}`,
      createdBy: user.id,
      cardPrefix: "SUP",
    })
    .returning();
  if (!workspace) throw new Error("Failed to seed workspace");

  const [board] = await db
    .insert(schema.boards)
    .values({
      publicId: testPublicId("bd"),
      name: "Customer Support",
      slug: `customer-support-${publicIdCounter}`,
      createdBy: user.id,
      workspaceId: workspace.id,
    })
    .returning();
  if (!board) throw new Error("Failed to seed board");

  const lists = new Map<string, { id: number; publicId: string }>();
  for (const [index, name] of args.listNames.entries()) {
    const [list] = await db
      .insert(schema.lists)
      .values({
        publicId: testPublicId("ls"),
        name,
        index,
        createdBy: user.id,
        boardId: board.id,
      })
      .returning();
    if (!list) throw new Error(`Failed to seed list ${name}`);
    lists.set(name, { id: list.id, publicId: list.publicId });
  }

  return { user, workspace, board, lists };
}

export async function seedCard(
  db: dbClient,
  args: {
    listId: number;
    createdBy: string;
    title?: string;
    description?: string;
  },
) {
  const [card] = await db
    .insert(schema.cards)
    .values({
      publicId: testPublicId("cd"),
      title: args.title ?? "Seeded support card",
      description: args.description ?? null,
      index: 0,
      createdBy: args.createdBy,
      listId: args.listId,
    })
    .returning();
  if (!card) throw new Error("Failed to seed card");
  return card;
}

export async function countRows(db: dbClient, table: PgTable) {
  const rows = await db.select().from(table);
  return rows.length;
}
