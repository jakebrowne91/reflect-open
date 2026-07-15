# Cloudflare Workers Deployment

This app is configured for Cloudflare Workers through `@opennextjs/cloudflare`.
The Supabase schema and data are already independent of Railway; deploying this
Worker does not move production traffic until the Worker route or DNS is pointed
at the Cloudflare deployment.

## Local Preview

From `apps/gsd`:

```bash
pnpm cloudflare:build
pnpm cloudflare:preview
```

For local Worker preview, copy `apps/web/.dev.vars.example` to
`apps/web/.dev.vars` and keep `NEXTJS_ENV=development`.

## Production Runtime

Use Cloudflare Worker secrets for private values:

```bash
cd apps/web
pnpm wrangler secret put POSTGRES_URL
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put S3_ACCESS_KEY_ID
pnpm wrangler secret put S3_SECRET_ACCESS_KEY
```

Add the same way for OAuth, Stripe, Retrograde support, Ari, email, and any
other production secrets used by `apps/web/src/env.ts` or package code.

Use a Supabase Postgres URL with the password URL-encoded:

```text
postgresql://postgres:<url-encoded-password>@db.<project-ref>.supabase.co:5432/postgres
```

Do not commit `.dev.vars`, `.env`, or raw secrets.

## Production Build Variables

If deploying with Cloudflare Workers Builds, set required production values in
Cloudflare's **Build variables and secrets** as well as the Worker runtime
environment. The Next build needs access to `NEXT_PUBLIC_*` values and any
server-side values used while building static pages.

The non-secret Supabase Storage and Postgres TLS defaults are in
`apps/web/wrangler.jsonc`. Review these before deploying a different Supabase
project.

## Deploy

From `apps/gsd`:

```bash
pnpm cloudflare:deploy
```

After smoke-testing the `workers.dev` URL, attach the custom domain or update DNS
in Cloudflare. Keep Railway running until the Cloudflare deployment passes login,
board load, card mutation, avatar upload, and attachment upload/download checks.

## Notes

- `nodejs_compat` is required because the app uses Node APIs and `pg`.
- `pg` must stay at `8.16.3` or newer for Workers TCP support.
- `POSTGRES_POOL_MAX=1` is intentional for direct Supabase Postgres from Workers.
  If traffic grows, use Cloudflare Hyperdrive or Supabase's pooler before raising
  this.
- `images.binding = "IMAGES"` enables Next image optimization through Cloudflare
  Images and may require Cloudflare Images to be enabled on the account.
