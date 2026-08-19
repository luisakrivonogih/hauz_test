# NOTES — Phase 0: Schema & Requirements Analysis

Source documents: `hauz-backend-interview-task.pdf` (task + schema spec), `hauz-auth-erd.html` (ERD diagram).
This file is the single source of truth for the schema — Phase 2's setup script and TypeScript types must match it exactly. **Schema is final: no added/renamed/removed tables, fields, relationships, indexes, or allowed values.**

---

## 1. Scope confirmed from the PDF

- Build: registration w/ email verification, login (email+password), logout.
- Registration form fields: first name, last name, email, password, Personal Account role (`consumer`|`realtor`), contact phone (optional).
- Stack mandated: TypeScript, TanStack Start, Appwrite Auth + Functions + TablesDB.
- Explicitly out of scope: password recovery, phone verification, MFA, OAuth, account switching, Agency/Staff accounts. (Matches CLAUDE_CODE_PROMPT.md "Чего не делать".)
- Tests not required, but code should stay testable (business logic separated from transport).
- No hardcoded project-specific values — must work against the reviewer's own Appwrite project.
- Deployment optional; GitHub repo + README with env vars/Appwrite setup + assumptions is required.
- Review criteria emphasize: correctness, schema understanding, correct Appwrite Auth/Functions/DB usage, code quality, basic FE↔BE integration.

## 2. Appwrite Auth "user" (NOT a HAUZ table)

- Represents the human: owns email, password, `emailVerification` status, session.
- Managed entirely by Appwrite Auth. **Do not create a table for it.**
- Its `$id` is stored in `account_access_grants.appwrite_user_id` — that's the *only* link between Auth identity and HAUZ data.
- One Auth user ↔ 0..N `account_access_grants` (cardinality confirmed in ERD: Auth user side = `1`, grants side = `0..N`).

## 3. HAUZ tables — exact fields, types, constraints

Appwrite-managed fields (`$id`, `$createdAt`, `$updatedAt`, `$sequence`, `$databaseId`, `$tableId`, `$permissions`) exist on every row but are not modeled explicitly. **Every HAUZ row `$id` is a self-generated UUID**, not Appwrite's autoid — this is what makes the pre-generation-before-write chain possible.

### 3.1 `accounts`

| Field | Type | Constraint |
|---|---|---|
| `account_type` | enum | Required, immutable. Only allowed/used value in this task: `individual`. |
| `status` | enum | Required, **no default** — must be explicitly set. Allowed: `active` \| `blocked`. Registration sets `active`. |
| `terminated_at` | datetime | Nullable; immutable once set. Not touched by registration (stays null). |
| `current_access_grant_id` | varchar(36) | Nullable. Stores an `account_access_grants.$id` as a **plain string field — explicitly NOT an Appwrite relationship attribute.** |

Indexes:
- `ix_accounts_type_status` on (`account_type`, `status`)
- `ix_accounts_terminated` on (`terminated_at`)

### 3.2 `account_access_grants`

| Field | Type | Constraint |
|---|---|---|
| `appwrite_user_id` | varchar(36) | Required. Stores the Appwrite Auth user's `$id`. |
| `account_id` | relationship → `accounts` | Required. |
| `revoked_at` | datetime | Nullable; immutable once set. Null on creation = active grant. |

Indexes:
- `ix_grants_user_access` on (`appwrite_user_id`, `revoked_at`)
- `ix_grants_account_history` on (`account_id`, `revoked_at`)
- `ix_grants_user_account` on (`appwrite_user_id`, `account_id`, `revoked_at`)

Purpose: connects one Auth user to one or more HAUZ Accounts; each row is one *period of access* (revocation keeps history instead of deleting). Cardinality vs `accounts`: grants side `0..N`, accounts side `1` (many grants can reference one account over time).

### 3.3 `personal_accounts`

| Field | Type | Constraint |
|---|---|---|
| `account_id` | relationship → `accounts` | Required **and unique** (one personal profile per account). |
| `role_id` | relationship → `personal_roles` | Required. |
| `first_name` | varchar(100) | Required. |
| `last_name` | varchar(100) | Required. |
| `contact_phone` | varchar(20) | Nullable; **E.164 format when present.** |

Indexes:
- `uq_personal_account` on (`account_id`) — unique index, enforces the 1:1 with `accounts`.
- `ix_personal_role` on (`role_id`)
- `ix_personal_contact_phone` on (`contact_phone`)

Cardinality vs `accounts`: 1:1 (`accounts` side `1`, `personal_accounts` side `1`).
Cardinality vs `personal_roles`: many `personal_accounts` → one `personal_roles` row (roles side `1`, personal_accounts side `0..N`).

### 3.4 `personal_roles`

| Field | Type | Constraint |
|---|---|---|
| `value` | enum or varchar | Required, unique, **immutable**. Allowed: `consumer` \| `realtor`. |

Index:
- `uq_personal_roles_value` on (`value`)

`consumer` and `realtor` rows are **seed/existing data** — generated UUIDs, created once by the setup script, looked up by `value` (not created per-registration).

## 4. Relationship cardinality summary (from ERD)

```
APPWRITE_AUTH_USER (1) ──appwrite_user_id──> account_access_grants (0..N)
account_access_grants (0..N) ──account_id──> accounts (1)
accounts (0..1) <──current_access_grant_id (soft ref, varchar)──> account_access_grants (0..1)
accounts (1) <──account_id──> personal_accounts (1)
personal_accounts (0..N) ──role_id──> personal_roles (1)
```

`current_access_grant_id` is drawn as a dashed "current" relation in the ERD specifically to visually distinguish it from real relationships — reinforcing the PDF's explicit callout that it's a plain string, not an Appwrite relationship attribute.

## 5. Registration write chain (from CLAUDE_CODE_PROMPT.md, cross-checked against schema)

All four HAUZ `$id`s (accounts, grant, personal_accounts — plus the already-known Auth user `$id`) are generated client-side-in-the-Function *before* any write, which is what avoids a circular-reference read-after-write:

1. `accounts` — `account_type: individual`, `status: active`, `current_access_grant_id: <pre-generated grant id>`.
2. `account_access_grants` — `appwrite_user_id: <auth user id>`, `account_id: <account id from step 1>`, `revoked_at: null`.
3. `personal_accounts` — `account_id: <account id>`, `role_id: <looked up from personal_roles by value>`, `first_name`, `last_name`, `contact_phone`.

Row permissions: read restricted to `Role.user(appwrite_user_id)`; writes only via the Function's server API key (never client SDK).

## 6. State machine (drives which screen/loader result is shown)

| State | Condition | UI |
|---|---|---|
| No Auth user | no session / user doesn't exist | Registration form |
| Auth user, unverified | `emailVerification: false` | "Verify your email" screen + resend action |
| Verified, no HAUZ records | `emailVerification: true`, no active grant found for this `appwrite_user_id` | Finish-registration (re-registration/completion) screen |
| Verified, records exist | active grant + personal_accounts found | Authenticated page |

Registration is only "complete" once *both* email verification and HAUZ record creation have succeeded — matches PDF: "Do not show registration as complete if verification or HAUZ record creation has failed."

## 7. Idempotency / edge-case requirements (from PDF + CLAUDE_CODE_PROMPT.md)

- Auth user creation + verification email are **outside** any DB transaction — so "Auth user exists, no HAUZ rows" is a reachable, expected state, not an error state.
- Before writing the chain: check for an existing **non-revoked** grant for `appwrite_user_id`. If found, treat as already-registered (idempotent no-op or "already exists" response depending on whether personal_accounts also exists).
- `personal_accounts.account_id` unique index is a backstop, not the primary idempotency mechanism (the grant check is primary, since it's the first thing queryable by `appwrite_user_id`).
- Partial failure must not leave orphan rows: use Transactions API (Appwrite 1.8+) if available, otherwise manual compensating deletes in reverse order.
- Repeated/duplicate submit of the registration form (double-click) must not create duplicate Auth users or duplicate HAUZ chains.

## 8. Open questions / assumptions

1. **Appwrite version — RESOLVED.** User confirmed: support both. Phase 3's registration logic will attempt the Transactions API (`createTransaction`/`updateTransaction`) first; if that call fails because the endpoint doesn't exist (older Appwrite < 1.8), fall back at runtime to the same write order with explicit compensating deletes in reverse order on partial failure. No env flag needed — this is a runtime capability check, not a deploy-time choice, so the same build works against either version.
2. **`personal_roles.value` attribute type.** Schema says "enum or varchar" — either is schema-compliant. Assumption: use Appwrite's native `enum` attribute type (`consumer`, `realtor`) since it enforces the allowed-value constraint at the DB level for free and the PDF explicitly allows it.
3. **Relationship attribute configuration.** `account_access_grants.account_id`, `personal_accounts.account_id`, `personal_accounts.role_id` are Appwrite relationship attributes. Assumption: one-way relationships (child → parent only), since nothing in the task requires traversing accounts→grants or roles→personal_accounts through the SDK relationship mechanism — traversal is always done by explicit query instead (e.g. `current_access_grant_id` lookups, grant lookups by `appwrite_user_id`). This avoids Appwrite auto-creating reverse two-way attributes that aren't in the spec. Will revisit in Phase 2 if this proves wrong.
4. **`account_id` relationship type on `personal_accounts`.** "Required and unique" + `uq_personal_account` index → one-to-one relationship type.
5. **`account_id` relationship type on `account_access_grants`.** Many grants per account over time → many-to-one relationship type.
6. **`role_id` relationship type on `personal_accounts`.** Many personal_accounts per role → many-to-one relationship type.
7. **Seeding `personal_roles`.** Setup script must be idempotent: look up existing rows by `value` before inserting, since re-running must not create duplicates or violate `uq_personal_roles_value`.
8. **Email verification redirect URL.** Needs an app route (e.g. `/verify-email`) that completes `updateVerification` with `userId`/`secret` query params from the emailed link, and must be documented in README as the URL to register in the Appwrite project.
9. **Password rules.** PDF doesn't specify complexity requirements beyond Appwrite Auth's own minimum (8 chars). Assumption: rely on Appwrite's built-in validation, no extra app-side password policy.
10. **`contact_phone` E.164 validation.** Enforced at the form layer (zod) and re-validated server-side in the Function (never trust client). Empty/omitted phone stored as `null`, not empty string.
11. **Login state resolution.** "If registration or email verification is incomplete, show the correct next step" applies to login too, not just the post-registration flow — the loader that resolves state machine step (section 6) is shared between post-registration and post-login redirects.

No other ambiguities found — schema and task scope are otherwise fully specified.

## 9. Phase 2 findings

- **Relationship columns have no `required` flag in the Appwrite TablesDB API.** `createRelationshipColumn` only accepts `relatedTableId`, `type`, `twoWay`, `key`, `twoWayKey`, `onDelete` — there's no `required` param like scalar columns have. So "Required" on `account_access_grants.account_id`, `personal_accounts.account_id`, and `personal_accounts.role_id` cannot be enforced at the schema level; it's enforced by the Function always supplying these fields on every create (Phase 3), never by a DB constraint. Documented as a limitation for README Phase 6.
- Relationship type mapping used by `scripts/setup-schema.ts`: `account_access_grants.account_id` = ManyToOne (many grants per account), `personal_accounts.account_id` = OneToOne (enforced additionally by the `uq_personal_account` unique index), `personal_accounts.role_id` = ManyToOne (many personal_accounts per role). All one-way (`twoWay: false`) — nothing in the task requires traversing accounts→grants or roles→personal_accounts through the SDK relationship mechanism; traversal is always an explicit query instead.
- All 4 tables created with `rowSecurity: true` so per-row `Role.user(appwrite_user_id)` read permissions (set by the Function at write time) actually take effect. `personal_roles` doesn't need any client-facing permissions at all — the frontend hardcodes the `consumer`/`realtor` choice (it's fixed schema vocabulary, not project-specific data) and only the Function (via its dynamically-scoped key) ever reads that table.
- `onDelete: RelationMutate.Restrict` on all relationship columns — this task never cascade-deletes; compensating-delete logic in Phase 3 must delete child rows before parent rows, which restrict is consistent with.
- Confirmed `node-appwrite` v28 exposes exactly the Transactions API CLAUDE_CODE_PROMPT.md describes: `createTransaction({ttl})` → mutating calls take a `transactionId` param → `updateTransaction({transactionId, commit: true})` (or `rollback: true`). This will drive Phase 3's primary path, with manual reverse-order compensating deletes as the fallback when the endpoint is unavailable (older Appwrite).
- All HAUZ row `$id`s (including the `personal_roles` seed rows) are generated with Node's `crypto.randomUUID()`, not Appwrite's `ID.unique()`, per the PDF's explicit "use a generated UUID for each HAUZ row $id."
- `scripts/setup-schema.ts` runs directly via `node --env-file=.env scripts/setup-schema.ts` — Node 24's native TypeScript support (confirmed working) means no ts-node/tsx dependency is needed for this one script.

## 10. Phase 3 findings (Appwrite Function)

- `functions/register-personal-account/` is a self-contained npm package (own `package.json`/`node_modules`/`tsconfig.json`, compiled with `tsc` to `dist/`, entrypoint `dist/main.js`) — deliberately not importing anything from the app's `src/`, so it stays a plain zip-and-upload (or `appwrite push`) deployable unit. It keeps its own small copy of the row types instead.
- Caller identity comes from the Appwrite-injected `x-appwrite-user-id` request header, never from the request body — the body only carries profile fields (firstName/lastName/role/contactPhone). This means a caller can't spoof registering HAUZ records against someone else's Auth user id; it also means the Function's "Execute access" must include the `users` role (any logged-in user), documented for Phase 6.
- The Function authenticates its own Appwrite client with the per-execution dynamic key (`req.headers['x-appwrite-key']`), falling back to a static `APPWRITE_API_KEY` function env var if that header is empty. Kept both paths because I can't verify against a live Appwrite 1.8 instance from this environment which one is populated by default; documenting this hedge for Phase 6 (verify dynamic key is present after first real deploy, drop the fallback if so).
- `Models.Row.$sequence` is typed as `string` in `node-appwrite` 28 (not `number`) — fixed in both `src/types/hauz.ts` and the Function's local types after `tsc` caught the mismatch when the row types were used as `TablesDB.listRows<Row>` generic arguments.
- `functions/**` is excluded from the root `tsconfig.json` — it's a separate compilation unit (NodeNext module resolution + `noUncheckedIndexedAccess`, vs. the app's bundler resolution), verified independently via its own `npm run build`. Root ESLint still lints it for style consistency across the repo.
- Idempotency is enforced by querying `account_access_grants` for a non-revoked row by `appwrite_user_id` before deciding whether to create a fresh chain or complete a partial one. This is a read-then-write check, not a DB-level uniqueness constraint (the schema has none on `appwrite_user_id` alone, by design — one Auth user may hold grants to multiple HAUZ accounts platform-wide). It closes the realistic retry/double-submit cases from the PDF's edge-case list but isn't airtight against a contrived simultaneous-request race; mitigated further by disabling the submit control client-side (Phase 4). Documenting as an accepted limitation for README Phase 6 rather than adding distributed-locking complexity out of scope for this task.
