# DinnerSix Backend

Cloudflare Worker API for DinnerSix email sign-in, email-tagged registrations, async matching status, and match confirmation.

## Local development

```bash
npm install
npm run dev
```

The frontend currently calls the deployed backend by default:

```txt
https://dinner-six-backend.shijanhoo.workers.dev
```

For local frontend/backend development, start this Worker locally and run the frontend with:

```bash
VITE_API_BASE=http://127.0.0.1:8789 npm run dev
```

## API

- `POST /auth/start` — generates a 6-digit sign-in code and emails it to the user.
- `POST /auth/verify` — verifies the email code and returns a bearer token.
- `GET /me` — returns signed-in user and their current registration, if any.
- `GET /restaurants` — restaurant preview data.
- `POST /registrations` — creates/updates the registration for the signed-in email.
- `POST /match/confirm` — confirms a ready match.

## Email sending

Production uses Resend to send sign-in codes. Dev codes are disabled by default and must not be enabled in production.

Required production secret:

```bash
npx wrangler secret put RESEND_API_KEY
```

Recommended sender configuration in `wrangler.toml`:

```toml
[vars]
RETURN_DEV_CODES = "false"
EMAIL_PROVIDER = "resend"
EMAIL_FROM = "DinnerSix <hello@your-verified-domain.com>"
```

Important: Resend requires the `EMAIL_FROM` domain to be verified for real production sending. `onboarding@resend.dev` is only suitable for Resend test/onboarding scenarios and may only send to verified account emails.

For automated tests only, the Worker supports `EMAIL_TEST_MODE=true`; this bypasses the external email API while still confirming that production responses do not expose `devCode`.

## Cloudflare deployment

```bash
npm install
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY
npm run deploy
```

For durable production storage, create three KV namespaces and uncomment/fill the `kv_namespaces` bindings in `wrangler.toml`:

```bash
npx wrangler kv namespace create AUTH_CODES
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create REGISTRATIONS
```

Then redeploy:

```bash
npm run deploy
```

Frontend configuration:

```bash
VITE_API_BASE=https://dinner-six-backend.shijanhoo.workers.dev
```

## Required production checklist

- `RETURN_DEV_CODES=false` in Worker vars.
- `RESEND_API_KEY` set as a Worker secret.
- `JWT_SECRET` set as a Worker secret.
- `EMAIL_FROM` uses a verified sender domain.
- KV namespaces are bound for `AUTH_CODES`, `SESSIONS`, and `REGISTRATIONS`.
