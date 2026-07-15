import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { createLogger } from "@kan/logger";

const log = createLogger("api");

const API_LOGGING_ACTIVE_KEY = "__kanApiLoggingActive";

type LoggedNextApiRequest = NextApiRequest & {
  [API_LOGGING_ACTIVE_KEY]?: boolean;
};

function getHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getRequestId(req: NextApiRequest): string {
  return (
    getHeaderValue(req.headers["x-request-id"]) ??
    getHeaderValue(req.headers["x-trace-id"]) ??
    randomUUID()
  );
}

function getQueryKeys(req: NextApiRequest): string[] {
  return Object.keys(req.query).sort();
}

export function withApiLogging(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const loggedReq = req as LoggedNextApiRequest;
    if (loggedReq[API_LOGGING_ACTIVE_KEY]) {
      return await handler(req, res);
    }

    loggedReq[API_LOGGING_ACTIVE_KEY] = true;
    const start = Date.now();
    const requestId = getRequestId(req);
    const traceId = getHeaderValue(req.headers["x-trace-id"]);
    const route = req.url?.split("?")[0] ?? "unknown";
    const method = req.method ?? "UNKNOWN";
    req.headers["x-request-id"] = requestId;

    log.info(
      {
        service: "gsd",
        component: "api",
        requestId,
        traceId,
        procedure: route,
        transport: "rest",
        method,
        queryKeys: getQueryKeys(req),
        userAgent: getHeaderValue(req.headers["user-agent"]),
      },
      "API request start",
    );

    let handlerError: unknown;
    let result: unknown;
    try {
      result = await handler(req, res);
    } catch (err) {
      handlerError = err;
      if (res.statusCode < 400) {
        res.statusCode = 500;
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }

    const duration = Date.now() - start;
    const statusCode =
      handlerError && res.statusCode < 400 ? 500 : res.statusCode;
    const meta = {
      service: "gsd",
      component: "api",
      requestId,
      traceId,
      procedure: route,
      transport: "rest",
      method,
      duration,
      status: statusCode,
      ...(handlerError !== undefined ? { err: handlerError } : {}),
    };

    if (statusCode >= 500) {
      log.error(meta, "API error");
    } else if (statusCode >= 400) {
      log.warn(meta, "API warning");
    } else {
      log.info(meta, "API OK");
    }

    return result;
  };
}
