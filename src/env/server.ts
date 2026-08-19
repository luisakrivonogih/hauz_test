import { z } from 'zod'

/**
 * Server-only runtime configuration.
 *
 * Deliberately does NOT include an Appwrite API key: the running app never
 * writes to HAUZ tables directly (only the Appwrite Function does, using its
 * own dynamically-scoped key). The app reads HAUZ rows using the logged-in
 * user's session, which is enough because row read permissions are granted
 * to `Role.user(userId)`. The API key is only needed by `scripts/setup-schema.ts`,
 * which has its own, separate env loader so the key can never end up in the
 * app's server bundle.
 */
const serverEnvSchema = z.object({
  VITE_APPWRITE_ENDPOINT: z.url(),
  VITE_APPWRITE_PROJECT_ID: z.string().min(1),
  VITE_APP_URL: z.url(),

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
