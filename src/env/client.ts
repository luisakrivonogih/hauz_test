import { z } from 'zod'

/**
 * Env vars safe to ship in the browser bundle. Vite only inlines `VITE_`-
 * prefixed vars into client code, which is what keeps this list free of
 * secrets by construction (the API key below has no VITE_ prefix and lives
 * only in scripts/setup-schema.ts's own env loader).
 */
const clientEnvSchema = z.object({
  VITE_APPWRITE_ENDPOINT: z.url(),
  VITE_APPWRITE_PROJECT_ID: z.string().min(1),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

let cached: ClientEnv | undefined

export function getClientEnv(): ClientEnv {
  if (!cached) {
    cached = clientEnvSchema.parse({
      VITE_APPWRITE_ENDPOINT: import.meta.env.VITE_APPWRITE_ENDPOINT,
      VITE_APPWRITE_PROJECT_ID: import.meta.env.VITE_APPWRITE_PROJECT_ID,
    })
  }
  return cached
}
