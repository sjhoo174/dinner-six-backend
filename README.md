# DinnerSix Backend

Cloudflare Worker API for DinnerSix Google OAuth sign-in, D1-backed user/registration storage, async matching status, and match confirmation.

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

- `GET /auth/google/start?return_to=<frontend-url>` — redirects to Google OAuth.
- `GET /auth/google/callback` — Google OAuth callback; creates/updates user, creates a session, redirects back to the frontend with `#auth_token=...`.
- `GET /me` — returns signed-in user and their current registration, if any.
- `GET /restaurants` — restaurant preview data.
- `POST /registrations` — creates/updates the registration for the signed-in Google email.
- `POST /match/confirm` — confirms a ready match.

Email-code sign-in endpoints now return `410 Gone`; use Google OAuth only.

## Cloudflare D1 relational storage

DinnerSix stores user data and preferences in Cloudflare D1 (free-tier friendly relational SQLite):

- `users`: Google email and display name.
- `sessions`: bearer sessions issued after OAuth.
- `oauth_states`: short-lived OAuth state nonces.
- `registrations`: email-tagged user data including name, phone number, area, budget, preferences, match result, and confirmation status.

Create the database:

```bash
npx wrangler d1 create dinner-six-db
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "dinner-six-db"
database_id = "<database_id_from_cloudflare>"
```

Apply migrations:

```bash
npx wrangler d1 migrations apply dinner-six-db --remote
```

Local tests use in-memory storage so CI can run without a Cloudflare account, but production should deploy with D1 bound.

If you previously applied an older migration that included `avatar_url`, `provider`, or `provider_id` in `users`, recreate the D1 database or add a follow-up migration to drop those columns before production use. The current schema intentionally keeps only `email`, `name`, `created_at`, and `updated_at` for users.


## Google OAuth setup

Create OAuth credentials in Google Cloud Console:

- Application type: Web application
- Authorized redirect URI:

```txt
https://dinner-six-backend.shijanhoo.workers.dev/auth/google/callback
```

Set Cloudflare Worker secrets:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Set/confirm Worker vars in `wrangler.toml`:

```toml
[vars]
FRONTEND_URL = "https://dinner-six.pages.dev"
PUBLIC_BACKEND_URL = "https://dinner-six-backend.shijanhoo.workers.dev"
ALLOWED_RETURN_ORIGINS = "https://dinner-six.pages.dev"
```

For local Vite testing, include local origins in `ALLOWED_RETURN_ORIGINS` as this repo currently does.

## Deployment

```bash
npm install
npm run check
npm test
npx wrangler d1 migrations apply dinner-six-db --remote
npm run deploy
```

Frontend configuration:

```bash
VITE_API_BASE=https://dinner-six-backend.shijanhoo.workers.dev
```

## Required production checklist

- D1 database created and `database_id` set in `wrangler.toml`.
- D1 migration applied remotely.
- `JWT_SECRET` set as a Worker secret.
- `GOOGLE_CLIENT_ID` set as a Worker secret.
- `GOOGLE_CLIENT_SECRET` set as a Worker secret.
- Google OAuth redirect URI points to `/auth/google/callback` on the Worker.
- `FRONTEND_URL` / `ALLOWED_RETURN_ORIGINS` match the deployed frontend domain.
