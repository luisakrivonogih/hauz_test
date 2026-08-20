import { z } from 'zod'

/**
 * Server-only runtime configuration.
 *
 * The app never writes to HAUZ tables directly (only the Appwrite Function
 * does, using its own dynamically-scoped key) — that boundary is unaffected
 * by APPWRITE_API_KEY below. The app reads HAUZ rows using the logged-in
 * user's session, which is enough because row read permissions are granted
 * to `Role.user(userId)`.
 *
 * APPWRITE_API_KEY IS read here (unlike what an earlier version of this
 * comment claimed) because node-appwrite's `account.createEmailPasswordSession`
 * only returns a non-empty `secret` field "if the request was made with an
 * API key" (see node_modules/node-appwrite/dist/models.d.ts, `Session.secret`)
 * — without it, every session created during register/login comes back with
 * an empty secret, so the app can never actually authenticate as that user
 * afterward. The key only needs the `sessions.write` scope for this; it is
 * never passed to TablesDB calls in this app.
 */
const serverEnvSchema = z.object({
  VITE_APPWRITE_ENDPOINT: z.url(),
  VITE_APPWRITE_PROJECT_ID: z.string().min(1),
  VITE_APP_URL: z.url(),

  APPWRITE_API_KEY: z.string().min(1),

  APPWRITE_DATABASE_ID: z.string().min(1),
  APPWRITE_TABLE_ACCOUNTS_ID: z.string().min(1),
  APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID: z.string().min(1),
  APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID: z.string().min(1),
  APPWRITE_TABLE_PERSONAL_ROLES_ID: z.string().min(1),
  APPWRITE_FUNCTION_REGISTER_PERSONAL_ACCOUNT_ID: z.string().min(1),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | undefined

/** Parsed lazily (not at module load) so importing this file has no side effects during client-side type-checking passes. */
export function getServerEnv(): ServerEnv {
  if (!cached) {
    cached = serverEnvSchema.parse(process.env)
  }
  return cached
}
