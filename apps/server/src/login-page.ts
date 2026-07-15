/**
 * The login page: one password field, served by the server itself so the
 * whole flow stays same-origin. Deliberately dependency-free — this renders
 * before any client code is trusted.
 */
export function renderLoginPage(next: string, failed: boolean): string {
  // Only ever bounce back to a same-origin path — a full URL here would be
  // an open redirect.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reflect — Sign in</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: light-dark(#fafafa, #111113);
    color: light-dark(#1a1a1e, #ececf0);
  }
  main { width: min(20rem, 90vw); text-align: center; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.375rem; }
  p { margin: 0 0 1.5rem; font-size: 0.875rem; opacity: 0.65; }
  input {
    width: 100%; box-sizing: border-box; padding: 0.625rem 0.75rem;
    font-size: 1rem; border-radius: 0.5rem;
    border: 1px solid light-dark(#d4d4d8, #3f3f46);
    background: light-dark(#fff, #1c1c1f); color: inherit;
  }
  input:focus { outline: 2px solid #6366f1; outline-offset: -1px; }
  button {
    width: 100%; margin-top: 0.75rem; padding: 0.625rem; font-size: 1rem;
    border: 0; border-radius: 0.5rem; background: #6366f1; color: #fff;
    font-weight: 500; cursor: pointer;
  }
  button:hover { background: #585bd8; }
  .error { color: #dc2626; font-size: 0.8125rem; margin: 0.75rem 0 0; }
</style>
</head>
<body>
<main>
  <h1>Reflect</h1>
  <p>Your notes are waiting.</p>
  <form method="post" action="/api/login">
    <input type="hidden" name="next" value="${safeNext.replaceAll('"', '&quot;')}" />
    <input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password" />
    <button type="submit">Sign in</button>
    ${failed ? '<p class="error">That password didn&rsquo;t match.</p>' : ''}
  </form>
</main>
</body>
</html>`
}
