import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionAppwriteClient } from './appwrite-session'
import { clearSessionSecret, readSessionSecret } from './session-cookie'
import { resolveAuthState } from './auth-state'

vi.mock('./appwrite-session', () => ({ createSessionAppwriteClient: vi.fn() }))
vi.mock('./session-cookie', () => ({
  readSessionSecret: vi.fn(),
  clearSessionSecret: vi.fn(),
}))
vi.mock('@/env/server', () => ({
  getServerEnv: () => ({
    APPWRITE_DATABASE_ID: 'db',
    APPWRITE_TABLE_ACCOUNTS_ID: 'accounts',
    APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID: 'account_access_grants',
    APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID: 'personal_accounts',
    APPWRITE_TABLE_PERSONAL_ROLES_ID: 'personal_roles',
  }),
}))

const mockedCreateSessionAppwriteClient = vi.mocked(createSessionAppwriteClient)
const mockedReadSessionSecret = vi.mocked(readSessionSecret)
const mockedClearSessionSecret = vi.mocked(clearSessionSecret)

const PREFS = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'consumer' as const,
  contactPhone: '+15551234567',
}

function emptyList() {
  return { rows: [], total: 0 }
}

function rowList(rows: unknown[]) {
  return { rows, total: rows.length }
}

function mockClient(opts: { getUser?: () => unknown; listRows?: (tableId: string) => unknown } = {}) {
  const account = {
    get: vi.fn(() => (opts.getUser ? Promise.resolve(opts.getUser()) : Promise.reject(new Error('no user')))),
  }
  const tablesDB = {
    listRows: vi.fn(({ tableId }: { tableId: string }) =>
      Promise.resolve(opts.listRows ? opts.listRows(tableId) : emptyList()),
    ),
  }
  mockedCreateSessionAppwriteClient.mockReturnValue({
    client: {} as never,
    account: account as never,
    tablesDB: tablesDB as never,
    functions: {} as never,
  })
  return { account, tablesDB }
}

describe('resolveAuthState', () => {
  beforeEach(() => {
    mockedCreateSessionAppwriteClient.mockReset()
    mockedReadSessionSecret.mockReset()
    mockedClearSessionSecret.mockReset()
  })

  it('returns anonymous without calling Appwrite when there is no session cookie', async () => {
    mockedReadSessionSecret.mockReturnValue(undefined)

    const state = await resolveAuthState()

    expect(state).toEqual({ kind: 'anonymous' })
    expect(mockedCreateSessionAppwriteClient).not.toHaveBeenCalled()
  })

  it('clears the cookie and returns anonymous when the session is invalid/expired', async () => {
    mockedReadSessionSecret.mockReturnValue('stale-secret')
    mockClient() // account.get() rejects by default

    const state = await resolveAuthState()

    expect(state).toEqual({ kind: 'anonymous' })
    expect(mockedClearSessionSecret).toHaveBeenCalled()
  })

  it('returns unverified when the Auth user has not confirmed their email', async () => {
    mockedReadSessionSecret.mockReturnValue('secret')
    mockClient({ getUser: () => ({ $id: 'user-1', email: 'ada@example.com', emailVerification: false, prefs: PREFS }) })

    const state = await resolveAuthState()

    expect(state).toEqual({ kind: 'unverified', email: 'ada@example.com' })
  })

  it('returns needsCompletion when verified but no active grant exists', async () => {
    mockedReadSessionSecret.mockReturnValue('secret')
    mockClient({
      getUser: () => ({ $id: 'user-1', email: 'ada@example.com', emailVerification: true, prefs: PREFS }),
      listRows: (tableId) => (tableId === 'account_access_grants' ? emptyList() : emptyList()),
    })

    const state = await resolveAuthState()

    expect(state).toEqual({ kind: 'needsCompletion', email: 'ada@example.com', prefs: PREFS })
  })

  it('returns needsCompletion when a grant exists but the personal_accounts row does not (self-heals)', async () => {
    mockedReadSessionSecret.mockReturnValue('secret')
    mockClient({
      getUser: () => ({ $id: 'user-1', email: 'ada@example.com', emailVerification: true, prefs: PREFS }),
      listRows: (tableId) => {
        if (tableId === 'account_access_grants') return rowList([{ account_id: 'account-1' }])
        if (tableId === 'personal_accounts') return emptyList()
        throw new Error(`unexpected table ${tableId}`)
      },
    })

    const state = await resolveAuthState()

    expect(state).toEqual({ kind: 'needsCompletion', email: 'ada@example.com', prefs: PREFS })
  })

  it('returns authenticated (built from prefs) when a grant and profile both exist', async () => {
    mockedReadSessionSecret.mockReturnValue('secret')
    mockClient({
      getUser: () => ({ $id: 'user-1', email: 'ada@example.com', emailVerification: true, prefs: PREFS }),
      listRows: (tableId) => {
        if (tableId === 'account_access_grants') return rowList([{ account_id: 'account-1' }])
        if (tableId === 'personal_accounts') return rowList([{ account_id: 'account-1' }])
        throw new Error(`unexpected table ${tableId}`)
      },
    })

    const state = await resolveAuthState()

    expect(state).toEqual({
      kind: 'authenticated',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'consumer',
      contactPhone: '+15551234567',
    })
  })

  it('handles a grant.account_id returned as an expanded row instead of a plain id', async () => {
    mockedReadSessionSecret.mockReturnValue('secret')
    const listRows = vi.fn(({ tableId }: { tableId: string }) => {
      if (tableId === 'account_access_grants') {
        return Promise.resolve(rowList([{ account_id: { $id: 'account-1' } }]))
      }
      if (tableId === 'personal_accounts') return Promise.resolve(rowList([{}]))
      throw new Error(`unexpected table ${tableId}`)
    })
    mockedCreateSessionAppwriteClient.mockReturnValue({
      client: {} as never,
      account: {
        get: vi.fn().mockResolvedValue({
          $id: 'user-1',
          email: 'ada@example.com',
          emailVerification: true,
          prefs: PREFS,
        }),
      } as never,
      tablesDB: { listRows } as never,
      functions: {} as never,
    })

    const state = await resolveAuthState()

    expect(state.kind).toBe('authenticated')
    expect(listRows).toHaveBeenCalledWith(
      expect.objectContaining({ queries: expect.arrayContaining([expect.stringContaining('account-1')]) }),
    )
  })
})
