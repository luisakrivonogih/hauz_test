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
| `APPWRITE_API_KEY` | **setup script only** | Server API key with database/table read+write scopes. Never read by the running app — only by `scripts/setup-schema.ts`, on purpose (see NOTES.md §1). |

The running app never holds an all-powerful API key: it reads HAUZ rows using the logged-in user's own session (permitted by the row-level read permissions the Function sets), and it triggers the Function using that same session rather than a key.

## Appwrite project setup

1. **Create an Appwrite project** (1.8+, Cloud or self-hosted).
2. **Enable Auth → Email/Password.**
3. **Configure SMTP** so verification emails actually send: Appwrite Cloud has default SMTP with a low send limit suitable for testing; for self-hosted or production, configure your own SMTP provider under Auth settings → SMTP. Without this, `account.createVerification` will still succeed but no email will arrive — check the Appwrite console's Auth → Messages log if verification emails don't show up.
4. **Add a Web platform** (Overview → Platforms) with the hostname the app runs on (e.g. `localhost` for local dev). Appwrite rejects verification redirect URLs whose host isn't a registered platform.
5. **Create an API key** (Overview → Integrate → API Keys) with `databases.read` and `databases.write` scopes (TablesDB is exposed under these same scope names). This key is only ever used locally by the setup script — never deployed anywhere.
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

**Why the auth business logic lives in `src/server/auth-actions.ts` instead of directly in `src/server-fns/auth.ts`**: `createServerFn`-wrapped handlers need a request-scoped context (an `AsyncLocalStorage` TanStack Start's real server runtime sets up) that doesn't exist when a test calls them directly — attempting to unit-test them errors with "No Start context found." `src/server-fns/auth.ts` is now a thin pass-through layer; the actual logic in `auth-actions.ts` is plain functions, directly testable the same way the Function's `register.ts` already was designed to be.

**Not covered**: `scripts/setup-schema.ts` (thin, repetitive Appwrite API orchestration — the calls themselves were verified against the installed SDK's type definitions instead) and React components (no component-level rendering tests; the routes were smoke-tested manually against a running dev server instead, per the state-machine walkthrough in `NOTES.md`).

## Schema setup script

`scripts/setup-schema.ts` creates the database, all 4 tables (with the exact columns, types, indexes, and index names from the PDF), and seeds the `personal_roles` rows — idempotently, so re-running it is safe (it checks what already exists before creating anything). Run it with:

```bash
npm run setup:schema
```

It reads `VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APPWRITE_DATABASE_ID`, and the four `APPWRITE_TABLE_*_ID` variables from `.env` — the same IDs the running app and the Function are configured with, so all three stay in sync.

## Deploying the Function

`functions/register-personal-account` is a self-contained Node package (its own `package.json`/`node_modules`) — it doesn't import anything from the app's `src/`, so it deploys independently.

1. `cd functions/register-personal-account && npm install && npm run build` (compiles `src/` to `dist/`).
2. In the Appwrite console, create a Function:
   - **Runtime**: Node.js 18+ (any recent Node runtime Appwrite offers).
   - **Entrypoint**: `dist/main.js`.
   - **Execute access**: the `users` role — any logged-in Appwrite Auth user, since the app invokes this Function using the caller's own session (see NOTES.md §10 on why: the caller's identity comes from the platform-verified `x-appwrite-user-id` header, not anything the client can spoof in the request body).
   - **Scopes**: grant this Function's dynamic API key `databases.read`/`databases.write` (or the specific TablesDB row/table scopes your Appwrite version exposes) so `req.headers['x-appwrite-key']` carries write access at execution time. If your Appwrite version doesn't populate that header, set a static `APPWRITE_API_KEY` function environment variable instead — `main.ts` falls back to it automatically.
   - **Environment variables**: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_DATABASE_ID`, `APPWRITE_TABLE_ACCOUNTS_ID`, `APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID`, `APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID`, `APPWRITE_TABLE_PERSONAL_ROLES_ID` — same values as the app's `.env`. Optionally `APPWRITE_API_KEY` (see above).
3. Upload/deploy `functions/register-personal-account` (either the built `dist/` alongside `package.json`, or the whole folder if deploying via the Appwrite CLI, which runs the build for you).
4. Copy the Function's `$id` into the app's `.env` as `APPWRITE_FUNCTION_REGISTER_PERSONAL_ACCOUNT_ID`.

**Local testing without deploying**: `npm run build && npm start` inside the Function's folder runs `dist/main.js` directly under Node, but it still needs a real `req`/`res` context to do anything useful — the practical way to test it end-to-end is the Appwrite CLI's `appwrite run function`, or simply deploying to a dev Appwrite project and triggering it through the running app.

## Assumptions & limitations

- **Appwrite relationship columns have no "required" flag.** `account_access_grants.account_id`, `personal_accounts.account_id`, and `personal_accounts.role_id` are "Required" per the schema, but Appwrite's `createRelationshipColumn` API has no such option — it's enforced by the Function always supplying these fields, not by a DB constraint.
- **The dynamic per-execution API key (`x-appwrite-key`) vs. a static Function env var key** — the Function tries the dynamic header first and falls back to `APPWRITE_API_KEY` if unset. Written this way because I couldn't verify against a live Appwrite 1.8 instance from this environment which one is populated by default; verify after your first real deploy and drop the fallback if the dynamic key works.
- **Idempotency is a read-then-write check**, not a DB-level uniqueness constraint (the schema has none on `appwrite_user_id` alone, by design — one Auth user may hold grants to multiple HAUZ accounts platform-wide). It closes the realistic retry/double-submit cases but isn't airtight against a contrived simultaneous-request race for a brand-new user; mitigated client-side by disabling the submit control while a request is in flight.
- **"Verified, HAUZ records exist, but no active grant" is treated as needing fresh registration**, which creates a new HAUZ identity rather than reactivating the old one. This state is only reachable via manual data tampering — nothing in this app's scope ever revokes a grant — and building reactivation would require an account-switching-adjacent feature that's explicitly out of scope.
- **Registration profile fields (name/role/phone) are stored in the Appwrite Auth user's `prefs`** between account creation and HAUZ-chain creation (since HAUZ records aren't created until after email verification, but the PDF's single registration form collects everything upfront). This is a native Appwrite Auth feature, not a HAUZ table, so it doesn't touch the schema — and it means finishing registration works correctly even if verification happens on a different device, as long as the user logs in there.
- **The `consumer`/`realtor` role choice is hardcoded in the frontend** rather than fetched from `personal_roles` — the schema fixes these as the only two allowed values, and the table itself is only ever read by the Function (with elevated access), not by the browser session, so there's nothing to fetch.
- **Password rules**: no app-specific password policy beyond Appwrite Auth's own built-in minimum (8 characters).
- Not implemented, per the PDF's explicit scope: password recovery, phone verification, MFA, OAuth, account switching, Agency/Staff accounts.
- No deployed instance is included — this README documents what's needed to run the app against your own Appwrite project.
