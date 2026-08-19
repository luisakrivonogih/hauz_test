import { z } from 'zod'

/**
 * Configured as Function environment variables in the Appwrite console
 * (Functions -> register-personal-account -> Settings -> Variables) — see
 * the README. Endpoint/project/database/table IDs must match the values
 * scripts/setup-schema.ts was run with.
 */
const envSchema = z.object({
  APPWRITE_ENDPOINT: z.url(),
  APPWRITE_PROJECT_ID: z.string().min(1),
  APPWRITE_DATABASE_ID: z.string().min(1),
  APPWRITE_TABLE_ACCOUNTS_ID: z.string().min(1),
  APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID: z.string().min(1),
  APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID: z.string().min(1),
  APPWRITE_TABLE_PERSONAL_ROLES_ID: z.string().min(1),
  /**
   * Optional static fallback API key. Prefer leaving unset: Appwrite grants
   * each execution a dynamically-scoped key via the `x-appwrite-key`
   * request header when the function has database scopes enabled, which
   * main.ts reads first. This is only a safety net for Appwrite setups
   * where that header isn't populated.
   */
  APPWRITE_API_KEY: z.string().optional(),
})

export type FunctionEnv = z.infer<typeof envSchema>

export function getFunctionEnv(): FunctionEnv {
  return envSchema.parse(process.env)
}
