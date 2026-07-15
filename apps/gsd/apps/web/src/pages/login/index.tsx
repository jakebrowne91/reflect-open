import type { GetServerSideProps } from "next";

import LoginView from "~/views/auth/login";

// We deliberately do NOT clear `gsd-admin.session_token` /
// `__Secure-gsd-admin.session_token` here — those belong to the admin SSO
// iframe flow and live under a separate cookie name. Visiting /login on the
// direct app must not destroy a parallel admin SSO session.
//
// We DO clear partitioned variants of the standard session cookie name. Older
// SSO implementations wrote partitioned cookies under that shared name, and
// users may still be holding stale partitioned values that would otherwise
// collide with the freshly-set unpartitioned direct-login cookie.
const EXPIRED_SESSION_COOKIES = [
  "gsd.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
  "__Secure-gsd.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
  "__Secure-gsd.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None; Partitioned",
  "kan.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None",
  "__Secure-kan.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None",
  "__Secure-kan.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None; Partitioned",
  "better-auth.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None",
  "__Secure-better-auth.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None",
  "__Secure-better-auth.session_token=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None; Partitioned",
];

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Set-Cookie", EXPIRED_SESSION_COOKIES);

  return { props: {} };
};

export default function LoginPage() {
  return <LoginView />;
}
