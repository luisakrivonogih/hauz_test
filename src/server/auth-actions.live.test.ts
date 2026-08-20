/**
 * Live integration test — hits your REAL Appwrite project over the network.
 * Not part of `npm test` (excluded there; see vitest.config.ts) because it
 * needs APPWRITE_API_KEY and a fully set-up project. Run with:
 *
 *   npm run test:live
 *
 * Runs the actual registerAction -> (admin force-verify, standing in for
 * clicking the email link) -> finishRegistrationAction chain, then reads the
 * written rows back directly from Appwrite with an admin client to prove
 * they exist — not mocked. One `it()` on purpose: each step depends on state
 * from the previous one (session secret, account id), so this is one
 * sequential scenario, not independent cases. Cleans up everything it
 * creates in `afterAll`, including on failure, so re-runs stay idempotent
 * and the project is left as it found it.
 */
import { randomUUID } from 'node:crypto'
import { Client, Query, TablesDB, Users } from 'node-appwrite'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { getServerEnv } from '@/env/server'
import type { AccountAccessGrantRow, AccountRow, PersonalAccountRow } from '@/types/hauz'
import { relatedId } from '@/types/hauz'

const cookieState = vi.hoisted(() => ({ secret: undefined as string | undefined }))

vi.mock('./session-cookie', () => ({
  readSessionSecret: () => cookieState.secret,
  writeSessionSecret: (secret: string) => {
    cookieState.secret = secret
  },
  clearSessionSecret: () => {
    cookieState.secret = undefined
  },
}))

const { registerAction, finishRegistrationAction } = await import('./auth-actions')

const apiKey = process.env.APPWRITE_API_KEY
if (!apiKey) {
  throw new Error(
    'APPWRITE_API_KEY must be set (run via: npm run test:live, which loads .env)',
  )
}

const env = getServerEnv()
const adminClient = new Client()
  .setEndpoint(env.VITE_APPWRITE_ENDPOINT)
  .setProject(env.VITE_APPWRITE_PROJECT_ID)
  .setKey(apiKey)
const adminUsers = new Users(adminClient)
const adminTablesDB = new TablesDB(adminClient)

const testEmail = `hauz-live-test+${randomUUID()}@example.com`
const testPassword = 'LiveTest1234!'

let authUserId: string | undefined
let accountId: string | undefined
let grantId: string | undefined
let personalAccountId: string | undefined

describe('registration, live against a real Appwrite project', () => {
  afterAll(async () => {
    if (personalAccountId) {
      await adminTablesDB
        .deleteRow({
          databaseId: env.APPWRITE_DATABASE_ID,
          tableId: env.APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID,
          rowId: personalAccountId,
        })
        .catch(() => undefined)
    }
    if (grantId) {
      await adminTablesDB
        .deleteRow({
          databaseId: env.APPWRITE_DATABASE_ID,
          tableId: env.APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID,
          rowId: grantId,
        })
        .catch(() => undefined)
    }
    if (accountId) {
      await adminTablesDB
        .deleteRow({
          databaseId: env.APPWRITE_DATABASE_ID,
          tableId: env.APPWRITE_TABLE_ACCOUNTS_ID,
          rowId: accountId,
        })
        .catch(() => undefined)
    }
    if (authUserId) {
      await adminUsers.delete({ userId: authUserId }).catch(() => undefined)
    }
  })

  it('registers, force-verifies, completes registration, and writes real DB rows', async () => {
    // 1. registerAction creates a real Auth user.
    const registerResult = await registerAction({
      firstName: 'Live',
      lastName: 'Test',
      email: testEmail,
      password: testPassword,
      role: 'consumer',
      contactPhone: null,
    })
    console.log('registerAction result:', JSON.stringify(registerResult))
    expect(registerResult.ok).toBe(true)
    if (!registerResult.ok) throw new Error(`registerAction failed: ${JSON.stringify(registerResult)}`)
    expect(registerResult.data.email).toBe(testEmail)
    expect(cookieState.secret).toBeDefined()

    const users = await adminUsers.list({ queries: [Query.equal('email', testEmail)] })
    expect(users.users).toHaveLength(1)
    authUserId = users.users[0]?.$id
    expect(authUserId).toBeDefined()
    expect(users.users[0]?.emailVerification).toBe(false)
    if (!authUserId) throw new Error('unreachable')

    // 2. Admin force-verification stands in for the user clicking the emailed link.
    await adminUsers.updateEmailVerification({ userId: authUserId, emailVerification: true })

    // 3. finishRegistrationAction invokes the real deployed Function, which
    // writes accounts/account_access_grants/personal_accounts rows for real.
    const finishResult = await finishRegistrationAction()
    console.log('finishRegistrationAction result:', JSON.stringify(finishResult))
    expect(finishResult.ok).toBe(true)
    if (!finishResult.ok) throw new Error(`finishRegistrationAction failed: ${JSON.stringify(finishResult)}`)
    accountId = finishResult.data.accountId
    expect(accountId).toBeDefined()
    if (!accountId) throw new Error('unreachable')

    // 4. Read the rows back with an admin client — proof they were actually written.
    const account = (await adminTablesDB.getRow({
      databaseId: env.APPWRITE_DATABASE_ID,
      tableId: env.APPWRITE_TABLE_ACCOUNTS_ID,
      rowId: accountId,
    })) as unknown as AccountRow
    expect(account.account_type).toBe('individual')
    expect(account.status).toBe('active')

    const grants = await adminTablesDB.listRows({
      databaseId: env.APPWRITE_DATABASE_ID,
      tableId: env.APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID,
      queries: [Query.equal('appwrite_user_id', authUserId), Query.limit(1)],
    })
    const grant = grants.rows[0] as unknown as AccountAccessGrantRow | undefined
    expect(grant).toBeDefined()
    expect(grant && relatedId(grant.account_id)).toBe(accountId)
    expect(grant?.revoked_at).toBeNull()
    grantId = grant?.$id

    const personalAccounts = await adminTablesDB.listRows({
      databaseId: env.APPWRITE_DATABASE_ID,
      tableId: env.APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID,
      queries: [Query.equal('account_id', accountId), Query.limit(1)],
    })
    const personalAccount = personalAccounts.rows[0] as unknown as PersonalAccountRow | undefined
    expect(personalAccount).toBeDefined()
    expect(personalAccount?.first_name).toBe('Live')
    expect(personalAccount?.last_name).toBe('Test')
    personalAccountId = personalAccount?.$id

    // 5. Idempotency: calling finishRegistrationAction again must not create a second chain.
    const secondFinishResult = await finishRegistrationAction()
    expect(secondFinishResult.ok).toBe(true)
    if (!secondFinishResult.ok) throw new Error('unreachable')
    expect(secondFinishResult.data.accountId).toBe(accountId)

    const grantsAfterRetry = await adminTablesDB.listRows({
      databaseId: env.APPWRITE_DATABASE_ID,
      tableId: env.APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID,
      queries: [Query.equal('appwrite_user_id', authUserId), Query.limit(10)],
    })
    expect(grantsAfterRetry.rows).toHaveLength(1)
  })
})
