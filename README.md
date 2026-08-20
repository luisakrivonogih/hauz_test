# HAUZ backend interview task

TanStack Start + TypeScript + Appwrite (Auth, Functions, TablesDB). Implements Personal Account registration with email verification, login, and logout against the provided HAUZ schema (see `NOTES.md` for the full schema breakdown and the design decisions made along the way).

## Stack & architecture

- **TypeScript**, strict mode, no `any`.
- **TanStack Start** (React) for the frontend, server functions, and server-side route guards.
- **Appwrite Auth** for the registered human (email/password, session, email verification).
- **Appwrite TablesDB** for the 4 HAUZ tables (`accounts`, `account_access_grants`, `personal_accounts`, `personal_roles`).
- **One Appwrite Function** (`register-personal-account`) is the *only* thing that ever writes to HAUZ tables — the app's server functions only read (permitted by row-level `Role.user(...)` read permissions) and trigger the Function.
- Session lives in an **httpOnly cookie** holding the Appwrite session secret, set/read/cleared entirely server-side. No Appwrite SDK calls happen from the browser; the client and server Appwrite SDK instances are kept in explicitly separate modules (`src/lib/appwrite-client.ts` vs `src/server/appwrite-session.ts`) so a server-only import can never end up in the client bundle.

## Prerequisites

- Node.js **24+** (the schema setup script uses Node's native TypeScript execution — no ts-node/tsx needed).
- An Appwrite project, **version 1.8+** (TablesDB and the Transactions API were introduced in 1.8.0). The registration Function detects the Transactions API at runtime and falls back to manual compensating deletes if it's unavailable, so an older project will still work, just without the atomicity guarantee.

## Environment variables

Copy `.env.example` to `.env` and fill in the values below.

| Variable | Used by | Description |
|---|---|---|
| `VITE_APPWRITE_ENDPOINT` | app (client + server) | Your Appwrite API endpoint, e.g. `https://cloud.appwrite.io/v1`. |
| `VITE_APPWRITE_PROJECT_ID` | app (client + server) | Your Appwrite project ID. |
| `VITE_APP_URL` | app (server) | The base URL this app is served from (e.g. `http://localhost:3000`, or your deployed URL). Used to build the email verification redirect link — must be registered as a Web platform in your Appwrite project (see below). |
| `APPWRITE_DATABASE_ID` | app (server) | ID of the database created by the setup script. |
| `APPWRITE_TABLE_ACCOUNTS_ID` | app (server) | ID of the `accounts` table. |
| `APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID` | app (server) | ID of the `account_access_grants` table. |
| `APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID` | app (server) | ID of the `personal_accounts` table. |
| `APPWRITE_TABLE_PERSONAL_ROLES_ID` | app (server) | ID of the `personal_roles` table. |
| `APPWRITE_FUNCTION_REGISTER_PERSONAL_ACCOUNT_ID` | app (server) | `$id` of the deployed `register-personal-account` Function. |
| `APPWRITE_API_KEY` | app (server) + setup script | See below — needed by both, for different reasons. |

`APPWRITE_API_KEY` is read in two places for two different reasons:
- `scripts/setup-schema.ts` (its own separate env loader) uses it to create the database/tables/columns/indexes and seed `personal_roles`. Needs `databases.read` + `databases.write`.
- The running app (`src/env/server.ts`) uses it **only** for the single `account.createEmailPasswordSession` call in register/login: node-appwrite only returns a non-empty session `secret` when that request carries an API key (undocumented in the guides, but stated directly in `node_modules/node-appwrite/dist/models.d.ts`'s `Session.secret` comment) — without it, the returned secret is an empty string and the cookie/session is effectively broken. Needs only `sessions.write`. Every other server-side call in the app (`src/server/appwrite-session.ts`) builds a plain session-scoped client with no key, so this never grants the running app write access to HAUZ tables — that boundary is unchanged and still enforced by row-level `Role.user(...)` permissions plus the Function being the only writer.

The simplest setup is one key with both scope sets (`databases.read`, `databases.write`, `sessions.write`). Split it into two keys if you want the setup-script key and the app's runtime key to be fully separate.

## Appwrite project setup

1. **Create an Appwrite project** (1.8+, Cloud or self-hosted).
2. **Enable Auth → Email/Password.**
3. **Configure SMTP** so verification emails actually send: Appwrite Cloud has default SMTP with a low send limit suitable for testing; for self-hosted or production, configure your own SMTP provider under Auth settings → SMTP. Without this, `account.createVerification` will still succeed but no email will arrive — check the Appwrite console's Auth → Messages log if verification emails don't show up.
4. **Add a Web platform** (Overview → Platforms) with the hostname the app runs on (e.g. `localhost` for local dev). Appwrite rejects verification redirect URLs whose host isn't a registered platform.
5. **Create an API key** (Overview → Integrate → API Keys) with `databases.read`, `databases.write`, and `sessions.write` scopes — see the `APPWRITE_API_KEY` row above for why the running app needs `sessions.write` too, not just the setup script.
6. **Run the schema setup script** (below) to create the database, tables, columns, indexes, and seed the `consumer`/`realtor` role rows.
7. **Deploy the Function** (below).
8. Fill in `.env` with the resulting database/table/function IDs.

## Running locally

```bash
npm install
cp .env.example .env   # fill in the values from the steps above
npm run setup:schema   # idempotent — safe to re-run
npm run dev
```

The app runs at `http://localhost:3000`.

Other scripts: `npm run build`, `npm run lint`, `npm run format`, `npm run check`.

## Testing

The task spec marks tests as not required, but a Vitest suite is included covering the pieces where it matters most: business logic, not framework glue.

```bash
npm test                                              # app: 47 tests
cd functions/register-personal-account && npm test    # Function: 26 tests
```

What's covered:

- `src/lib/validation.ts`, `src/lib/result.ts`, `src/types/hauz.ts` — pure schema/helper logic.
- `src/server/auth-state.ts` — the 4-state auth/registration state machine, with a mocked Appwrite client.
- `src/server/auth-actions.ts` — every registration/login/logout/verify/finish-registration action, including the conflict, invalid-credentials, expired-link, and partial-failure-recovery paths from the Phase 5 edge-case walkthrough in `NOTES.md`.
- `functions/register-personal-account/src/register.ts` — `completeRegistration`'s full branch coverage: fresh chain with/without the Transactions API, transaction rollback, manual reverse-order compensation, idempotent already-registered detection, resuming an interrupted chain, and the expanded-relationship-object defensive handling.
- `functions/register-personal-account/src/main.ts` and `validation.ts` — the Function's HTTP-shaped entrypoint (status code mapping, malformed JSON, missing auth context) and input validation.

There's also a live integration test, separate from the suite above because it needs a real, fully set-up Appwrite project (schema applied, Function deployed) and isn't run by default:

```bash
npm run test:live
```

`src/server/auth-actions.live.test.ts` runs the real register → (admin force-verifies the email, standing in for clicking the link) → finishRegistrationAction chain against your actual `.env` project — no mocks except the httpOnly-cookie layer, which needs TanStack Start's request context to run at all. It reads the written `accounts`/`account_access_grants`/`personal_accounts` rows back with an admin client to prove they were actually created, checks the idempotent-retry path, and cleans up everything (including the Auth user) in `afterAll`. Useful for exactly the failure mode this project hit during setup: `registerFn` returning `{ok:true}` while the session secret or the Function invocation was silently broken underneath — see NOTES.md §15 for what it caught.

**Why the auth business logic lives in `src/server/auth-actions.ts` instead of directly in `src/server-fns/auth.ts`**: `createServerFn`-wrapped handlers need a request-scoped context (an `AsyncLocalStorage` TanStack Start's real server runtime sets up) that doesn't exist when a test calls them directly — attempting to unit-test them errors with "No Start context found." `src/server-fns/auth.ts` is now a thin pass-through layer; the actual logic in `auth-actions.ts` is plain functions, directly testable the same way the Function's `register.ts` already was designed to be.

**Not covered**: `scripts/setup-schema.ts` (thin, repetitive Appwrite API orchestration — the calls themselves were verified against the installed SDK's type definitions instead) and React components (no component-level rendering tests; the routes were smoke-tested manually against a running dev server instead, per the state-machine walkthrough in `NOTES.md`).

## Schema setup script

`scripts/setup-schema.ts` creates the database, all 4 tables (with the exact columns, types, indexes, and index names from the PDF), and seeds the `personal_roles` rows — idempotently, so re-running it is safe (it checks what already exists before creating anything). Run it with:

```bash
npm run setup:schema
```

It reads `VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APPWRITE_DATABASE_ID`, and the four `APPWRITE_TABLE_*_ID` variables from `.env` — the same IDs the running app and the Function are configured with, so all three stay in sync.

If the script ever exits with `Schema setup failed: ...`, just re-run `npm run setup:schema` — every step checks what already exists first, so it's safe to run again and it'll pick up where it left off. This matters because the very last step seeds the `personal_roles` rows (`consumer`/`realtor`); if the script dies before reaching that step, the tables/columns look fully set up but registration will fail (the Function looks up the role by value and finds nothing).

## Deploying the Function

`functions/register-personal-account` is a self-contained Node package (its own `package.json`/`node_modules`) — it doesn't import anything from the app's `src/`, so it deploys independently.

1. `cd functions/register-personal-account && npm install && npm run build` (compiles `src/` to `dist/`).
2. **Check which Node runtimes your Appwrite instance actually offers** before picking one: `curl <endpoint>/functions/runtimes` (no auth needed) or the console's runtime dropdown. Cloud typically offers current Node versions; some self-hosted instances only have older ones (e.g. only `node-16.0`) installed. If the newest available runtime is Node **16 or 17**, you must use `node-appwrite@26.1.0` (see the pinned version already in `package.json` and the note below) — anything from `27.0.0` onward depends on `undici`, which itself needs the WHATWG Streams API globals (`ReadableStream` etc.) that don't exist before Node 18, and the whole Function crashes immediately with an opaque `Internal server error` and empty logs. `node-appwrite@26.1.0` is the last version built on `node-fetch-native-with-agent` instead, and still has everything this Function needs (`TablesDB`, the Transactions API, `Query`/`Permission`/`Role`) — confirmed against a live node-16.0 Appwrite Function. If your instance offers Node 18+, you can bump back to a newer `node-appwrite` if you want; just re-verify a real execution afterward, don't assume it from the version number alone.
3. In the Appwrite console, create a Function:
   - **Runtime**: whichever Node runtime you confirmed exists (see above).
   - **Entrypoint**: `dist/main.js`.
   - **Build commands**: `npm install && npm run build`.
   - **Execute access**: the `users` role — any logged-in Appwrite Auth user, since the app invokes this Function using the caller's own session (see NOTES.md §10 on why: the caller's identity comes from the platform-verified `x-appwrite-user-id` header, not anything the client can spoof in the request body).
   - **Scopes**: grant this Function's dynamic API key `databases.read`, `databases.write`, `tables.read`, `tables.write`, `rows.read`, `rows.write` — confirmed by trial against a live 1.9.6 instance that `databases.*` alone is not enough; TablesDB row operations specifically check `rows.*`/`tables.*` (and, depending on version, the legacy `collections.*`/`documents.*` names — safe to grant all of them). This makes `req.headers['x-appwrite-key']` carry write access at execution time — confirmed populated correctly on a live 1.9.6 instance, so the `APPWRITE_API_KEY` function-variable fallback in `main.ts` is a safety net for older/different setups, not the primary path.
   - **Environment variables**: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_DATABASE_ID`, `APPWRITE_TABLE_ACCOUNTS_ID`, `APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID`, `APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID`, `APPWRITE_TABLE_PERSONAL_ROLES_ID` — same values as the app's `.env`. Optionally `APPWRITE_API_KEY` (see above).
4. Upload/deploy `functions/register-personal-account` (either the built `dist/` alongside `package.json`, or the whole folder if deploying via the Appwrite CLI, which runs the build for you).
5. Copy the Function's `$id` into the app's `.env` as `APPWRITE_FUNCTION_REGISTER_PERSONAL_ACCOUNT_ID` — double-check it's the real deployed Function's `$id` and not a stale/placeholder value, since a wrong ID fails with a plain `Function with the requested ID could not be found` at execution time rather than anything more specific.

**Local testing without deploying**: `npm run build && npm start` inside the Function's folder runs `dist/main.js` directly under Node, but it still needs a real `req`/`res` context to do anything useful — the practical way to test it end-to-end is the Appwrite CLI's `appwrite run function`, or simply deploying to a dev Appwrite project and triggering it through the running app (see `npm run test:live` in Testing, above, which does exactly that).

## Assumptions & limitations

- **Appwrite relationship columns have no "required" flag.** `account_access_grants.account_id`, `personal_accounts.account_id`, and `personal_accounts.role_id` are "Required" per the schema, but Appwrite's `createRelationshipColumn` API has no such option — it's enforced by the Function always supplying these fields, not by a DB constraint.
- **The dynamic per-execution API key (`x-appwrite-key`) vs. a static Function env var key** — the Function tries the dynamic header first and falls back to `APPWRITE_API_KEY` if unset. Confirmed against a live Appwrite 1.9.6 instance that the dynamic header is populated correctly (as long as the Function's `scopes` are set — see "Deploying the Function" above), so the static fallback is a safety net for other setups, not the expected path.
- **Idempotency is a read-then-write check**, not a DB-level uniqueness constraint (the schema has none on `appwrite_user_id` alone, by design — one Auth user may hold grants to multiple HAUZ accounts platform-wide). It closes the realistic retry/double-submit cases but isn't airtight against a contrived simultaneous-request race for a brand-new user; mitigated client-side by disabling the submit control while a request is in flight.
- **"Verified, HAUZ records exist, but no active grant" is treated as needing fresh registration**, which creates a new HAUZ identity rather than reactivating the old one. This state is only reachable via manual data tampering — nothing in this app's scope ever revokes a grant — and building reactivation would require an account-switching-adjacent feature that's explicitly out of scope.
- **Registration profile fields (name/role/phone) are stored in the Appwrite Auth user's `prefs`** between account creation and HAUZ-chain creation (since HAUZ records aren't created until after email verification, but the PDF's single registration form collects everything upfront). This is a native Appwrite Auth feature, not a HAUZ table, so it doesn't touch the schema — and it means finishing registration works correctly even if verification happens on a different device, as long as the user logs in there.
- **The `consumer`/`realtor` role choice is hardcoded in the frontend** rather than fetched from `personal_roles` — the schema fixes these as the only two allowed values, and the table itself is only ever read by the Function (with elevated access), not by the browser session, so there's nothing to fetch.
- **Password rules**: no app-specific password policy beyond Appwrite Auth's own built-in minimum (8 characters).
- Not implemented, per the PDF's explicit scope: password recovery, phone verification, MFA, OAuth, account switching, Agency/Staff accounts.
- No deployed instance is included — this README documents what's needed to run the app against your own Appwrite project.
