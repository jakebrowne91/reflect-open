import { createHmac, timingSafeEqual } from "node:crypto";

export const RETROGRADE_ADMIN_SSO_ISSUER = "retrograde-admin";
export const RETROGRADE_ADMIN_SSO_AUDIENCE = "kan-retrograde-support";
export const DEFAULT_SUPPORT_WORKSPACE_SLUG = "retrograde-support";

export interface RetrogradeAdminSsoPayload {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;

  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

export function verifyRetrogradeAdminSsoToken(
  token: string,
  secret: string,
): RetrogradeAdminSsoPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  try {
    const expectedSignature = createHmac("sha256", secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const actualSignature = Buffer.from(encodedSignature, "base64url");

    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      return null;
    }

    const header = decodeJsonSegment(encodedHeader);
    if (
      !header ||
      typeof header !== "object" ||
      (header as Record<string, unknown>).alg !== "HS256"
    ) {
      return null;
    }

    const payload = decodeJsonSegment(encodedPayload);
    if (!payload || typeof payload !== "object") return null;

    const record = payload as Record<string, unknown>;
    const email = normalizeEmail(record.email);
    const now = Math.floor(Date.now() / 1000);

    if (
      record.iss !== RETROGRADE_ADMIN_SSO_ISSUER ||
      record.aud !== RETROGRADE_ADMIN_SSO_AUDIENCE ||
      !email ||
      record.sub !== email ||
      typeof record.iat !== "number" ||
      typeof record.exp !== "number" ||
      record.iat > now + 60 ||
      record.exp <= now
    ) {
      return null;
    }

    return {
      iss: RETROGRADE_ADMIN_SSO_ISSUER,
      aud: RETROGRADE_ADMIN_SSO_AUDIENCE,
      sub: email,
      email,
      iat: record.iat,
      exp: record.exp,
    };
  } catch {
    return null;
  }
}
