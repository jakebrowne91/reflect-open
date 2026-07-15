import { SignJWT } from "jose";
import { env } from "next-runtime-env";

const encoder = new TextEncoder();

/**
 * Creates a long‑lived unsubscribe link for a given user/subscriber.
 *
 * `${NEXT_PUBLIC_BASE_URL}/unsubscribe?token=<jwt>`
 *
 * The JWT payload only contains the subscriberId. There is no expiry
 * on purpose – unsubscribe links should remain valid indefinitely.
 *
 */
export async function createEmailUnsubscribeLink(
  userId: string,
): Promise<string | null> {
  const baseUrl = env("NEXT_PUBLIC_BASE_URL");
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;

  if (!baseUrl || !secret) {
    // Environment not configured for unsubscribe links.
    return null;
  }

  const token = await new SignJWT({ subscriberId: userId })
    .setProtectedHeader({ alg: "HS256" })
    // No expiration on purpose; unsubscribe links are long‑lived.
    .sign(encoder.encode(secret));

  return `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
}
