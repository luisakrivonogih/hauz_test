import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppwriteException } from 'node-appwrite'
import { createSessionAppwriteClient } from './appwrite-session'
import { clearSessionSecret, readSessionSecret, writeSessionSecret } from './session-cookie'
import { resolveAuthState } from './auth-state'
import { invokeRegisterFunction } from './register-function'
import {
  authStateAction,
  finishRegistrationAction,
  loginAction,
  logoutAction,
  registerAction,
  resendVerificationAction,
  verifyEmailAction,
} from './auth-actions'

vi.mock('./appwrite-session', () => ({ createSessionAppwriteClient: vi.fn() }))
vi.mock('./session-cookie', () => ({
  readSessionSecret: vi.fn(),
  writeSessionSecret: vi.fn(),
  clearSessionSecret: vi.fn(),
}))
vi.mock('./auth-state', () => ({ resolveAuthState: vi.fn() }))
vi.mock('./register-function', () => ({ invokeRegisterFunction: vi.fn() }))
vi.mock('@/env/server', () => ({
  getServerEnv: () => ({
    VITE_APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
    VITE_APPWRITE_PROJECT_ID: 'project-1',
    VITE_APP_URL: 'http://localhost:3000',
    APPWRITE_DATABASE_ID: 'db',
    APPWRITE_TABLE_ACCOUNTS_ID: 'accounts',
    APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID: 'account_access_grants',
    APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID: 'personal_accounts',
    APPWRITE_TABLE_PERSONAL_ROLES_ID: 'personal_roles',
    APPWRITE_FUNCTION_REGISTER_PERSONAL_ACCOUNT_ID: 'fn-1',
  }),
}))

const mockedCreateSessionAppwriteClient = vi.mocked(createSessionAppwriteClient)
const mockedReadSessionSecret = vi.mocked(readSessionSecret)
const mockedWriteSessionSecret = vi.mocked(writeSessionSecret)
const mockedClearSessionSecret = vi.mocked(clearSessionSecret)
const mockedResolveAuthState = vi.mocked(resolveAuthState)
const mockedInvokeRegisterFunction = vi.mocked(invokeRegisterFunction)

function mockAccount(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const account = {
    create: vi.fn().mockResolvedValue({ $id: 'user-1' }),
    createEmailPasswordSession: vi.fn().mockResolvedValue({ secret: 'session-secret', $id: 'sess-1' }),
    updatePrefs: vi.fn().mockResolvedValue({}),
    createVerification: vi.fn().mockResolvedValue({}),
    updateVerification: vi.fn().mockResolvedValue({}),
    deleteSession: vi.fn().mockResolvedValue({}),
    get: vi.fn(),
    ...overrides,
  }
  const client = { setSession: vi.fn() }
  mockedCreateSessionAppwriteClient.mockReturnValue({
    client: client as never,
    account: account as never,
    tablesDB: {} as never,
    functions: {} as never,
  })
  return { account, client }
}

const REGISTRATION_DATA = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  password: 'correct-horse',
  role: 'consumer' as const,
  contactPhone: null,
}

describe('auth actions', () => {
  beforeEach(() => {
    mockedCreateSessionAppwriteClient.mockReset()
    mockedReadSessionSecret.mockReset()
    mockedWriteSessionSecret.mockReset()
    mockedClearSessionSecret.mockReset()
    mockedResolveAuthState.mockReset()
    mockedInvokeRegisterFunction.mockReset()
  })

  describe('authStateAction', () => {
    it('delegates to resolveAuthState', async () => {
      mockedResolveAuthState.mockResolvedValue({ kind: 'anonymous' })
      expect(await authStateAction()).toEqual({ kind: 'anonymous' })
    })
  })

  describe('registerAction', () => {
    it('creates the account, starts a session, writes the cookie, and saves prefs + verification', async () => {
      const { account, client } = mockAccount()

      const result = await registerAction(REGISTRATION_DATA)

      expect(result).toEqual({ ok: true, data: { email: 'ada@example.com' } })
      expect(account.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ada@example.com', password: 'correct-horse', name: 'Ada Lovelace' }),
      )
      expect(client.setSession).toHaveBeenCalledWith('session-secret')
      expect(mockedWriteSessionSecret).toHaveBeenCalledWith('session-secret')
      expect(account.updatePrefs).toHaveBeenCalledWith({
        prefs: { firstName: 'Ada', lastName: 'Lovelace', role: 'consumer', contactPhone: null },
      })
      expect(account.createVerification).toHaveBeenCalledWith({ url: 'http://localhost:3000/verify-email' })
    })

    it('returns a conflict result when the email already exists, without writing a cookie', async () => {
      mockAccount({
        create: vi.fn().mockRejectedValue(new AppwriteException('already exists', 409, 'user_already_exists')),
      })

      const result = await registerAction(REGISTRATION_DATA)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('conflict')
      expect(mockedWriteSessionSecret).not.toHaveBeenCalled()
    })

    it('still succeeds if updatePrefs/createVerification fail after the session was created', async () => {
      mockAccount({
        updatePrefs: vi.fn().mockRejectedValue(new Error('boom')),
        createVerification: vi.fn().mockRejectedValue(new Error('boom')),
      })

      const result = await registerAction(REGISTRATION_DATA)

      expect(result).toEqual({ ok: true, data: { email: 'ada@example.com' } })
      expect(mockedWriteSessionSecret).toHaveBeenCalledWith('session-secret')
    })

    it('returns an external error if starting the session fails, without writing a cookie', async () => {
      mockAccount({
        createEmailPasswordSession: vi.fn().mockRejectedValue(new Error('boom')),
      })

      const result = await registerAction(REGISTRATION_DATA)

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('external')
      expect(mockedWriteSessionSecret).not.toHaveBeenCalled()
    })
  })

  describe('loginAction', () => {
    it('writes the cookie on success', async () => {
      const { account } = mockAccount()

      const result = await loginAction({ email: 'ada@example.com', password: 'x' })

      expect(result).toEqual({ ok: true, data: null })
      expect(account.createEmailPasswordSession).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'x' })
      expect(mockedWriteSessionSecret).toHaveBeenCalledWith('session-secret')
    })

    it('returns a validation error for wrong credentials without writing a cookie', async () => {
      mockAccount({
        createEmailPasswordSession: vi
          .fn()
          .mockRejectedValue(new AppwriteException('bad creds', 401, 'user_invalid_credentials')),
      })

      const result = await loginAction({ email: 'ada@example.com', password: 'wrong' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('validation')
      expect(mockedWriteSessionSecret).not.toHaveBeenCalled()
    })
  })

  describe('logoutAction', () => {
    it('deletes the session and clears the cookie when a session exists', async () => {
      mockedReadSessionSecret.mockReturnValue('session-secret')
      const { account } = mockAccount()

      const result = await logoutAction()

      expect(result).toEqual({ ok: true, data: null })
      expect(account.deleteSession).toHaveBeenCalledWith({ sessionId: 'current' })
      expect(mockedClearSessionSecret).toHaveBeenCalled()
    })

    it('clears the cookie even with no session (idempotent)', async () => {
      mockedReadSessionSecret.mockReturnValue(undefined)

      const result = await logoutAction()

      expect(result).toEqual({ ok: true, data: null })
      expect(mockedClearSessionSecret).toHaveBeenCalled()
      expect(mockedCreateSessionAppwriteClient).not.toHaveBeenCalled()
    })
  })

  describe('resendVerificationAction', () => {
    it('requires an existing session', async () => {
      mockedReadSessionSecret.mockReturnValue(undefined)
      const result = await resendVerificationAction()
      expect(result.ok).toBe(false)
    })

    it('sends a new verification email when logged in', async () => {
      mockedReadSessionSecret.mockReturnValue('session-secret')
      const { account } = mockAccount()

      const result = await resendVerificationAction()

      expect(result).toEqual({ ok: true, data: null })
      expect(account.createVerification).toHaveBeenCalledWith({ url: 'http://localhost:3000/verify-email' })
    })
  })

  describe('verifyEmailAction', () => {
    it('reports hasSession: true when this browser already carries a cookie', async () => {
      mockedReadSessionSecret.mockReturnValue('session-secret')
      mockAccount()

      const result = await verifyEmailAction({ userId: 'user-1', secret: 'tok' })

      expect(result).toEqual({ ok: true, data: { hasSession: true } })
    })

    it('reports hasSession: false when verifying from a different browser', async () => {
      mockedReadSessionSecret.mockReturnValue(undefined)
      mockAccount()

      const result = await verifyEmailAction({ userId: 'user-1', secret: 'tok' })

      expect(result).toEqual({ ok: true, data: { hasSession: false } })
    })

    it('reports an expired/invalid link as a validation error', async () => {
      mockAccount({
        updateVerification: vi.fn().mockRejectedValue(new AppwriteException('expired', 401, 'user_invalid_token')),
      })

      const result = await verifyEmailAction({ userId: 'user-1', secret: 'tok' })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('validation')
    })
  })

  describe('finishRegistrationAction', () => {
    it('requires an existing session', async () => {
      mockedReadSessionSecret.mockReturnValue(undefined)
      const result = await finishRegistrationAction()
      expect(result.ok).toBe(false)
    })

    it('rejects if the Auth user is not verified yet', async () => {
      mockedReadSessionSecret.mockReturnValue('session-secret')
      mockAccount({
        get: vi.fn().mockResolvedValue({ emailVerification: false, prefs: {} }),
      })

      const result = await finishRegistrationAction()

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.kind).toBe('validation')
      expect(mockedInvokeRegisterFunction).not.toHaveBeenCalled()
    })

    it('invokes the register Function with the stored prefs and returns its outcome', async () => {
      mockedReadSessionSecret.mockReturnValue('session-secret')
      mockAccount({
        get: vi.fn().mockResolvedValue({
          emailVerification: true,
          prefs: { firstName: 'Ada', lastName: 'Lovelace', role: 'consumer', contactPhone: null },
        }),
      })
      mockedInvokeRegisterFunction.mockResolvedValue({ ok: true, status: 'created', accountId: 'acc-1' })

      const result = await finishRegistrationAction()

      expect(result).toEqual({ ok: true, data: { accountId: 'acc-1' } })
      expect(mockedInvokeRegisterFunction).toHaveBeenCalledWith(expect.anything(), 'fn-1', {
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'consumer',
        contactPhone: null,
      })
    })

    it('surfaces a Function-side failure as an external error', async () => {
      mockedReadSessionSecret.mockReturnValue('session-secret')
      mockAccount({
        get: vi.fn().mockResolvedValue({
          emailVerification: true,
          prefs: { firstName: 'Ada', lastName: 'Lovelace', role: 'consumer', contactPhone: null },
        }),
      })
      mockedInvokeRegisterFunction.mockResolvedValue({ ok: false, kind: 'external', message: 'DB unreachable' })

      const result = await finishRegistrationAction()

      expect(result).toEqual({ ok: false, kind: 'external', message: 'DB unreachable' })
    })
  })
})
