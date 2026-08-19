import { Client, TablesDB } from 'node-appwrite'
import { getFunctionEnv } from './env.js'
import { ExternalServiceError, ValidationError } from './errors.js'
import { completeRegistration } from './register.js'
import { parseRegistrationInput } from './validation.js'

/**
 * Minimal shape of the context the Appwrite Node runtime injects. Not
 * published as a types package, so this is kept intentionally small and
 * matched against the stable, long-documented request/response surface
 * (req.headers, req.bodyRaw, res.json) rather than every runtime version's
 * exact convenience getters.
 */
interface AppwriteFunctionContext {
  req: {
    headers: Record<string, string>
    bodyRaw?: string
    body?: unknown
  }
  res: {
    json: (data: unknown, statusCode?: number) => unknown
  }
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

function readJsonBody(req: AppwriteFunctionContext['req']): unknown {
  if (typeof req.body === 'object' && req.body !== null) return req.body
  const raw = req.bodyRaw ?? (typeof req.body === 'string' ? req.body : '')
  if (!raw) return {}
  return JSON.parse(raw)
}

export default async function handler({ req, res, log, error }: AppwriteFunctionContext) {
  const appwriteUserId = req.headers['x-appwrite-user-id']
  if (!appwriteUserId) {
    return res.json(
      { status: 'error', kind: 'validation', message: 'Missing authenticated user context' },
      401,
    )
  }

  let env
  try {
    env = getFunctionEnv()
  } catch (err) {
    error('Function environment misconfigured', err)
    return res.json({ status: 'error', kind: 'external', message: 'Function misconfigured' }, 500)
  }

  const apiKey = req.headers['x-appwrite-key'] || env.APPWRITE_API_KEY || ''
  const client = new Client()
    .setEndpoint(env.APPWRITE_ENDPOINT)
    .setProject(env.APPWRITE_PROJECT_ID)
    .setKey(apiKey)
  const tablesDB = new TablesDB(client)

  try {
    const input = parseRegistrationInput(readJsonBody(req))

    const outcome = await completeRegistration(
      {
        tablesDB,
        databaseId: env.APPWRITE_DATABASE_ID,
        tables: {
          accounts: env.APPWRITE_TABLE_ACCOUNTS_ID,
          accountAccessGrants: env.APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID,
          personalAccounts: env.APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID,
          personalRoles: env.APPWRITE_TABLE_PERSONAL_ROLES_ID,
        },
      },
      appwriteUserId,
      input,
    )

    log(`Registration ${outcome.status} for user ${appwriteUserId}`)
    return res.json(
      { status: outcome.status, accountId: outcome.accountId },
      outcome.status === 'created' ? 201 : 200,
    )
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.json({ status: 'error', kind: 'validation', issues: err.issues }, 400)
    }
    if (err instanceof ExternalServiceError) {
      error(err.message, err.cause)
      return res.json({ status: 'error', kind: 'external', message: err.message }, 502)
    }
    if (err instanceof SyntaxError) {
      return res.json({ status: 'error', kind: 'validation', message: 'Invalid JSON body' }, 400)
    }
    error('Unexpected registration failure', err)
    return res.json({ status: 'error', kind: 'external', message: 'Unexpected failure' }, 500)
  }
}
