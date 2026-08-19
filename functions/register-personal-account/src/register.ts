import { randomUUID } from 'node:crypto'
import { Permission, Query, Role } from 'node-appwrite'
import type { TablesDB } from 'node-appwrite'
import { ExternalServiceError } from './errors.js'
import { relatedId } from './types.js'
import type { AccountAccessGrantRow, PersonalAccountRow, PersonalRoleRow } from './types.js'
import type { RegistrationInput } from './validation.js'

export interface TableIds {
  accounts: string
  accountAccessGrants: string
  personalAccounts: string
  personalRoles: string
}

export interface RegisterDeps {
  tablesDB: TablesDB
  databaseId: string
  tables: TableIds
}

export type RegistrationOutcome =
  | { status: 'created'; accountId: string; grantId: string; personalAccountId: string }
  | { status: 'already_registered'; accountId: string }

/**
 * Idempotent by design: Auth user creation and email verification happen
 * outside any DB transaction, so this can be called more than once for the
 * same appwriteUserId (retry after a dropped connection, double form
 * submit, or the dedicated "finish registration" step after verification).
 * It never creates a second chain for a user who already has one.
 */
export async function completeRegistration(
  deps: RegisterDeps,
  appwriteUserId: string,
  input: RegistrationInput,
): Promise<RegistrationOutcome> {
  const { tablesDB, databaseId, tables } = deps

  const activeGrant = await findActiveGrant(
    tablesDB,
    databaseId,
    tables.accountAccessGrants,
    appwriteUserId,
  )

  if (activeGrant) {
    const accountId = relatedId(activeGrant.account_id)
    const hasProfile = await personalAccountExists(
      tablesDB,
      databaseId,
      tables.personalAccounts,
      accountId,
    )
    if (hasProfile) {
      return { status: 'already_registered', accountId }
    }

    // Grant exists but the profile row doesn't: a prior attempt was
    // interrupted between steps (no transaction support, or the process
    // died mid-chain). Finish just the missing step, reusing the account.
    const roleId = await findRoleId(tablesDB, databaseId, tables.personalRoles, input.role)
    await createPersonalAccount(tablesDB, databaseId, tables.personalAccounts, {
      rowId: randomUUID(),
      accountId,
      roleId,
      appwriteUserId,
      input,
    })
    return { status: 'already_registered', accountId }
  }

  return createFreshChain(deps, appwriteUserId, input)
}

async function findActiveGrant(
  tablesDB: TablesDB,
  databaseId: string,
  tableId: string,
  appwriteUserId: string,
): Promise<AccountAccessGrantRow | undefined> {
  const result = await wrapExternal(
    () =>
      tablesDB.listRows<AccountAccessGrantRow>({
        databaseId,
        tableId,
        queries: [
          Query.equal('appwrite_user_id', appwriteUserId),
          Query.isNull('revoked_at'),
          Query.limit(1),
        ],
      }),
    'Failed to look up existing access grants',
  )
  return result.rows[0]
}

async function personalAccountExists(
  tablesDB: TablesDB,
  databaseId: string,
  tableId: string,
  accountId: string,
): Promise<boolean> {
  const result = await wrapExternal(
    () =>
      tablesDB.listRows<PersonalAccountRow>({
        databaseId,
        tableId,
        queries: [Query.equal('account_id', accountId), Query.limit(1)],
      }),
    'Failed to look up existing personal account profile',
  )
  return result.rows.length > 0
}

async function findRoleId(
  tablesDB: TablesDB,
  databaseId: string,
  tableId: string,
  value: 'consumer' | 'realtor',
): Promise<string> {
  const result = await wrapExternal(
    () =>
      tablesDB.listRows<PersonalRoleRow>({
        databaseId,
        tableId,
        queries: [Query.equal('value', value), Query.limit(1)],
      }),
    'Failed to look up personal role',
  )
  const role = result.rows[0]
  if (!role) {
    throw new ExternalServiceError(
      `personal_roles has no row for value=${value}; run the schema setup script`,
      undefined,
    )
  }
  return role.$id
}

async function createPersonalAccount(
  tablesDB: TablesDB,
  databaseId: string,
  tableId: string,
  args: {
    rowId: string
    accountId: string
    roleId: string
    appwriteUserId: string
    input: RegistrationInput
    transactionId?: string
  },
): Promise<void> {
  await wrapExternal(
    () =>
      tablesDB.createRow({
        databaseId,
        tableId,
        rowId: args.rowId,
        data: {
          account_id: args.accountId,
          role_id: args.roleId,
          first_name: args.input.firstName,
          last_name: args.input.lastName,
          contact_phone: args.input.contactPhone,
        },
        permissions: [Permission.read(Role.user(args.appwriteUserId))],
        transactionId: args.transactionId,
      }),
    'Failed to create personal account profile',
  )
}

async function createFreshChain(
  deps: RegisterDeps,
  appwriteUserId: string,
  input: RegistrationInput,
): Promise<RegistrationOutcome> {
  const { tablesDB, databaseId, tables } = deps

  const roleId = await findRoleId(tablesDB, databaseId, tables.personalRoles, input.role)

  const accountId = randomUUID()
  const grantId = randomUUID()
  const personalAccountId = randomUUID()
  const readPermission = [Permission.read(Role.user(appwriteUserId))]

  const transactionId = await tryOpenTransaction(tablesDB)
  const created: Array<{ tableId: string; rowId: string }> = []

  try {
    await wrapExternal(
      () =>
        tablesDB.createRow({
          databaseId,
          tableId: tables.accounts,
          rowId: accountId,
          data: {
            account_type: 'individual',
            status: 'active',
            current_access_grant_id: grantId,
          },
          permissions: readPermission,
          transactionId,
        }),
      'Failed to create account',
    )
    if (!transactionId) created.push({ tableId: tables.accounts, rowId: accountId })

    await wrapExternal(
      () =>
        tablesDB.createRow({
          databaseId,
          tableId: tables.accountAccessGrants,
          rowId: grantId,
          data: {
            appwrite_user_id: appwriteUserId,
            account_id: accountId,
            revoked_at: null,
          },
          permissions: readPermission,
          transactionId,
        }),
      'Failed to create account access grant',
    )
    if (!transactionId) created.push({ tableId: tables.accountAccessGrants, rowId: grantId })

    await createPersonalAccount(tablesDB, databaseId, tables.personalAccounts, {
      rowId: personalAccountId,
      accountId,
      roleId,
      appwriteUserId,
      input,
      transactionId,
    })
    if (!transactionId) created.push({ tableId: tables.personalAccounts, rowId: personalAccountId })

    if (transactionId) {
      await wrapExternal(
        () => tablesDB.updateTransaction({ transactionId, commit: true }),
        'Failed to commit registration transaction',
      )
    }
  } catch (error) {
    if (transactionId) {
      await tablesDB.updateTransaction({ transactionId, rollback: true }).catch(() => undefined)
    } else {
      await compensate(tablesDB, databaseId, created)
    }
    throw error
  }

  return { status: 'created', accountId, grantId, personalAccountId }
}

/** Real atomicity when the Transactions API (Appwrite 1.8+) is reachable; `undefined` signals the manual-compensation fallback path below. */
async function tryOpenTransaction(tablesDB: TablesDB): Promise<string | undefined> {
  try {
    const transaction = await tablesDB.createTransaction({ ttl: 30 })
    return transaction.$id
  } catch {
    return undefined
  }
}

async function compensate(
  tablesDB: TablesDB,
  databaseId: string,
  created: Array<{ tableId: string; rowId: string }>,
): Promise<void> {
  for (const row of created.reverse()) {
    await tablesDB
      .deleteRow({ databaseId, tableId: row.tableId, rowId: row.rowId })
      .catch(() => undefined)
  }
}

async function wrapExternal<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw new ExternalServiceError(message, error)
  }
}
