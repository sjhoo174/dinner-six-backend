# DinnerSix Backend

Cloudflare Worker API for DinnerSix email sign-in, email-tagged registrations, async matching status, and match confirmation.

## Local development

```bash
npm install
npm run dev
```

The frontend expects the API at `http://127.0.0.1:8789` in Vite dev mode unless `VITE_API_BASE` is set.

## API

- `POST /auth/start` — starts email sign-in and returns a local dev code when `RETURN_DEV_CODES=true`.
- `POST /auth/verify` — verifies email code and returns a bearer token.
- `GET /me` — returns signed-in user and their current registration, if any.
- `GET /restaurants` — restaurant preview data.
- `POST /registrations` — creates/updates the registration for the signed-in email.
- `POST /match/confirm` — confirms a ready match.

## Cloudflare deployment

```bash
npm install
npx wrangler secret put JWT_SECRET
npm run deploy
```

For durable production storage, create three KV namespaces and uncomment/fill the `kv_namespaces` bindings in `wrangler.toml`:

```bash
npx wrangler kv namespace create AUTH_CODES
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create REGISTRATIONS
```

Then set the frontend build variable to the deployed Worker URL:

```bash
VITE_API_BASE=https://<your-worker>.<your-subdomain>.workers.dev
```

Note: this repo includes a development email-code flow (`RETURN_DEV_CODES=true`) so local sign-in works without an email provider. Before public launch, wire an email sender and set `RETURN_DEV_CODES=false`.
