import { Account, Client, Functions, TablesDB } from 'node-appwrite'
import { getServerEnv } from '@/env/server'

/**
 * Server-only Appwrite client, scoped to a single request.
 *
 * Passing `sessionSecret` (read from our httpOnly cookie) authenticates the
 * client as that logged-in user, so every call runs with that user's own
 * permissions — the same boundary the schema enforces at the row level
 * (`Role.user(userId)` read access). With no secret, the client can still
 * call the unauthenticated Account endpoints (`create`,
 * `createEmailPasswordSession`, `updateVerification`) needed before a
 * session exists.
 *
 * `apiKey` is optional and NOT for TablesDB — pass it only for the single
 * `account.createEmailPasswordSession` call in registerAction/loginAction,
 * because node-appwrite only returns a non-empty session `secret` when the
 * request carries an API key (see src/env/server.ts's comment). Every other
 * call in this app uses a client built with no `apiKey`, so it never
 * bypasses row-level permissions on HAUZ tables.
 */
export function createSessionAppwriteClient(sessionSecret?: string, apiKey?: string) {
  const env = getServerEnv()

  const client = new Client()
    .setEndpoint(env.VITE_APPWRITE_ENDPOINT)
    .setProject(env.VITE_APPWRITE_PROJECT_ID)

  if (apiKey) {
    client.setKey(apiKey)
  }
  if (sessionSecret) {
    client.setSession(sessionSecret)
  }

  return {
    client,
    account: new Account(client),
    tablesDB: new TablesDB(client),
    functions: new Functions(client),
  }
}
