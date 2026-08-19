import { Permission, Role } from 'node-appwrite'
import type { TablesDB } from 'node-appwrite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalServiceError } from './errors.js'
import { completeRegistration } from './register.js'
import type { RegisterDeps } from './register.js'
import type { RegistrationInput } from './validation.js'

const DATABASE_ID = 'db'
const TABLES = {
  accounts: 'accounts',
  accountAccessGrants: 'account_access_grants',
  personalAccounts: 'personal_accounts',
  personalRoles: 'personal_roles',
}
const APPWRITE_USER_ID = 'user-1'
const INPUT: RegistrationInput = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'consumer',
  contactPhone: '+15551234567',
}
const READ_PERMISSION = [Permission.read(Role.user(APPWRITE_USER_ID))]

function emptyList() {
  return { rows: [], total: 0 }
}

function rowList(rows: unknown[]) {
  return { rows, total: rows.length }
}

/** Minimal mock satisfying only the TablesDB methods completeRegistration actually calls. */
function createMockTablesDB() {
  return {
    listRows: vi.fn(),
    createRow: vi.fn(),
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteRow: vi.fn(),
  }
}

type MockTablesDB = ReturnType<typeof createMockTablesDB>

function deps(tablesDB: MockTablesDB): RegisterDeps {
  return { tablesDB: tablesDB as unknown as TablesDB, databaseId: DATABASE_ID, tables: TABLES }
}

describe('completeRegistration', () => {
  let tablesDB: MockTablesDB

  beforeEach(() => {
    tablesDB = createMockTablesDB()
  })

  describe('fresh registration (no existing grant)', () => {
    beforeEach(() => {
      tablesDB.listRows.mockImplementation(({ tableId }: { tableId: string }) => {
        if (tableId === TABLES.accountAccessGrants) return Promise.resolve(emptyList())
        if (tableId === TABLES.personalRoles) {
          return Promise.resolve(rowList([{ $id: 'role-consumer', value: 'consumer' }]))
        }
        throw new Error(`unexpected listRows on ${tableId}`)
      })
      tablesDB.createRow.mockResolvedValue({})
    })

    it('creates accounts, grant, and personal_account in order inside a transaction when available', async () => {
      tablesDB.createTransaction.mockResolvedValue({ $id: 'tx-1' })
      tablesDB.updateTransaction.mockResolvedValue({ $id: 'tx-1' })

      const result = await completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)

      expect(result.status).toBe('created')
      if (result.status !== 'created') throw new Error('unreachable')

      expect(tablesDB.createRow).toHaveBeenCalledTimes(3)

      const [accountsCall, grantsCall, personalCall] = tablesDB.createRow.mock.calls.map((c) => c[0])

      expect(accountsCall).toMatchObject({
        databaseId: DATABASE_ID,
        tableId: TABLES.accounts,
        rowId: result.accountId,
        data: { account_type: 'individual', status: 'active', current_access_grant_id: result.grantId },
        permissions: READ_PERMISSION,
        transactionId: 'tx-1',
      })

      expect(grantsCall).toMatchObject({
        tableId: TABLES.accountAccessGrants,
        rowId: result.grantId,
        data: { appwrite_user_id: APPWRITE_USER_ID, account_id: result.accountId, revoked_at: null },
        transactionId: 'tx-1',
      })

      expect(personalCall).toMatchObject({
        tableId: TABLES.personalAccounts,
        rowId: result.personalAccountId,
        data: {
          account_id: result.accountId,
          role_id: 'role-consumer',
          first_name: 'Ada',
          last_name: 'Lovelace',
          contact_phone: '+15551234567',
        },
        transactionId: 'tx-1',
      })

      expect(tablesDB.updateTransaction).toHaveBeenCalledWith({ transactionId: 'tx-1', commit: true })
      expect(tablesDB.deleteRow).not.toHaveBeenCalled()
    })

    it('falls back to plain creates with no transactionId when the Transactions API is unavailable', async () => {
      tablesDB.createTransaction.mockRejectedValue(new Error('not supported'))

      const result = await completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)

      expect(result.status).toBe('created')
      for (const call of tablesDB.createRow.mock.calls) {
        expect(call[0].transactionId).toBeUndefined()
      }
      expect(tablesDB.updateTransaction).not.toHaveBeenCalled()
      expect(tablesDB.deleteRow).not.toHaveBeenCalled()
    })

    it('rolls back the transaction and does not manually delete when a create fails mid-transaction', async () => {
      tablesDB.createTransaction.mockResolvedValue({ $id: 'tx-1' })
      tablesDB.updateTransaction.mockResolvedValue({ $id: 'tx-1' })
      tablesDB.createRow
        .mockResolvedValueOnce({}) // accounts
        .mockRejectedValueOnce(new Error('boom')) // account_access_grants

      await expect(completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)).rejects.toThrow(
        ExternalServiceError,
      )

      expect(tablesDB.updateTransaction).toHaveBeenCalledWith({ transactionId: 'tx-1', rollback: true })
      expect(tablesDB.deleteRow).not.toHaveBeenCalled()
    })

    it('compensates in reverse order when a create fails with no transaction support', async () => {
      tablesDB.createTransaction.mockRejectedValue(new Error('not supported'))
      tablesDB.createRow
        .mockResolvedValueOnce({}) // accounts
        .mockResolvedValueOnce({}) // account_access_grants
        .mockRejectedValueOnce(new Error('boom')) // personal_accounts
      tablesDB.deleteRow.mockResolvedValue({})

      await expect(completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)).rejects.toThrow(
        ExternalServiceError,
      )

      expect(tablesDB.deleteRow).toHaveBeenCalledTimes(2)
      const [firstDelete, secondDelete] = tablesDB.deleteRow.mock.calls.map((c) => c[0])
      // Reverse creation order: grant (2nd created) deleted before account (1st created).
      expect(firstDelete).toMatchObject({ tableId: TABLES.accountAccessGrants })
      expect(secondDelete).toMatchObject({ tableId: TABLES.accounts })
    })

    it('throws ExternalServiceError without writing anything if the role is not seeded', async () => {
      tablesDB.listRows.mockImplementation(({ tableId }: { tableId: string }) => {
        if (tableId === TABLES.accountAccessGrants) return Promise.resolve(emptyList())
        if (tableId === TABLES.personalRoles) return Promise.resolve(emptyList())
        throw new Error(`unexpected listRows on ${tableId}`)
      })

      await expect(completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)).rejects.toThrow(
        ExternalServiceError,
      )
      expect(tablesDB.createRow).not.toHaveBeenCalled()
      expect(tablesDB.createTransaction).not.toHaveBeenCalled()
    })
  })

  describe('already registered', () => {
    it('returns already_registered without writing when a grant and a profile both exist', async () => {
      tablesDB.listRows.mockImplementation(({ tableId }: { tableId: string }) => {
        if (tableId === TABLES.accountAccessGrants) {
          return Promise.resolve(rowList([{ $id: 'grant-1', account_id: 'account-1' }]))
        }
        if (tableId === TABLES.personalAccounts) {
          return Promise.resolve(rowList([{ $id: 'pa-1', account_id: 'account-1' }]))
        }
        throw new Error(`unexpected listRows on ${tableId}`)
      })

      const result = await completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)

      expect(result).toEqual({ status: 'already_registered', accountId: 'account-1' })
      expect(tablesDB.createRow).not.toHaveBeenCalled()
    })

    it('handles a relationship field returned as an expanded row rather than a plain id', async () => {
      tablesDB.listRows.mockImplementation(({ tableId }: { tableId: string }) => {
        if (tableId === TABLES.accountAccessGrants) {
          return Promise.resolve(rowList([{ $id: 'grant-1', account_id: { $id: 'account-1' } }]))
        }
        if (tableId === TABLES.personalAccounts) {
          return Promise.resolve(rowList([{ $id: 'pa-1' }]))
        }
        throw new Error(`unexpected listRows on ${tableId}`)
      })

      const result = await completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)

      expect(result).toEqual({ status: 'already_registered', accountId: 'account-1' })
    })

    it('completes just the missing personal_accounts row when a grant exists but the profile does not', async () => {
      tablesDB.listRows.mockImplementation(({ tableId }: { tableId: string }) => {
        if (tableId === TABLES.accountAccessGrants) {
          return Promise.resolve(rowList([{ $id: 'grant-1', account_id: 'account-1' }]))
        }
        if (tableId === TABLES.personalAccounts) return Promise.resolve(emptyList())
        if (tableId === TABLES.personalRoles) {
          return Promise.resolve(rowList([{ $id: 'role-consumer', value: 'consumer' }]))
        }
        throw new Error(`unexpected listRows on ${tableId}`)
      })
      tablesDB.createRow.mockResolvedValue({})

      const result = await completeRegistration(deps(tablesDB), APPWRITE_USER_ID, INPUT)

      expect(result).toEqual({ status: 'already_registered', accountId: 'account-1' })
      expect(tablesDB.createRow).toHaveBeenCalledTimes(1)
      expect(tablesDB.createRow).toHaveBeenCalledWith(
        expect.objectContaining({
          tableId: TABLES.personalAccounts,
          data: expect.objectContaining({ account_id: 'account-1', role_id: 'role-consumer' }),
        }),
      )
      expect(tablesDB.createTransaction).not.toHaveBeenCalled()
    })
  })
})
