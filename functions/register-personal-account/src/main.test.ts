import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalServiceError, ValidationError } from './errors.js'
import { getFunctionEnv } from './env.js'
import handler from './main.js'
import { completeRegistration } from './register.js'

vi.mock('./register.js', () => ({ completeRegistration: vi.fn() }))
vi.mock('./env.js', () => ({ getFunctionEnv: vi.fn() }))

const mockedCompleteRegistration = vi.mocked(completeRegistration)
const mockedGetFunctionEnv = vi.mocked(getFunctionEnv)

const VALID_ENV = {
  APPWRITE_ENDPOINT: 'https://cloud.appwrite.io/v1',
  APPWRITE_PROJECT_ID: 'project-1',
  APPWRITE_DATABASE_ID: 'db',
  APPWRITE_TABLE_ACCOUNTS_ID: 'accounts',
  APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID: 'account_access_grants',
  APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID: 'personal_accounts',
  APPWRITE_TABLE_PERSONAL_ROLES_ID: 'personal_roles',
}

const VALID_BODY = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'consumer',
  contactPhone: null,
}

function makeContext(opts: { headers?: Record<string, string>; body?: unknown; bodyRaw?: string } = {}) {
  const json = vi.fn((data: unknown, status = 200) => ({ data, status }))
  return {
    req: { headers: opts.headers ?? {}, body: opts.body, bodyRaw: opts.bodyRaw },
    res: { json },
    log: vi.fn(),
    error: vi.fn(),
  }
}

describe('register-personal-account Function handler', () => {
  beforeEach(() => {
    mockedCompleteRegistration.mockReset()
    mockedGetFunctionEnv.mockReset()
    mockedGetFunctionEnv.mockReturnValue(VALID_ENV)
  })

  it('rejects requests with no authenticated user context', async () => {
    const ctx = makeContext({ body: VALID_BODY })
    const result = await handler(ctx)
    expect(result).toEqual({
      data: { status: 'error', kind: 'validation', message: 'Missing authenticated user context' },
      status: 401,
    })
    expect(mockedCompleteRegistration).not.toHaveBeenCalled()
  })

  it('returns 500 when the Function environment is misconfigured', async () => {
    mockedGetFunctionEnv.mockImplementation(() => {
      throw new Error('missing env var')
    })
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' }, body: VALID_BODY })

    const result = await handler(ctx)

    expect(result).toEqual({
      data: { status: 'error', kind: 'external', message: 'Function misconfigured' },
      status: 500,
    })
    expect(ctx.error).toHaveBeenCalled()
  })

  it('returns 201 and forwards the parsed body when registration creates a new chain', async () => {
    mockedCompleteRegistration.mockResolvedValue({
      status: 'created',
      accountId: 'acc-1',
      grantId: 'grant-1',
      personalAccountId: 'pa-1',
    })
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' }, body: VALID_BODY })

    const result = await handler(ctx)

    expect(result).toEqual({ data: { status: 'created', accountId: 'acc-1' }, status: 201 })
    expect(mockedCompleteRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 'db' }),
      'user-1',
      { firstName: 'Ada', lastName: 'Lovelace', role: 'consumer', contactPhone: null },
    )
  })

  it('returns 200 for an idempotent already_registered outcome', async () => {
    mockedCompleteRegistration.mockResolvedValue({ status: 'already_registered', accountId: 'acc-1' })
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' }, body: VALID_BODY })

    const result = await handler(ctx)

    expect(result).toEqual({ data: { status: 'already_registered', accountId: 'acc-1' }, status: 200 })
  })

  it('parses a JSON string body from bodyRaw', async () => {
    mockedCompleteRegistration.mockResolvedValue({ status: 'already_registered', accountId: 'acc-1' })
    const ctx = makeContext({
      headers: { 'x-appwrite-user-id': 'user-1' },
      bodyRaw: JSON.stringify(VALID_BODY),
    })

    await handler(ctx)

    expect(mockedCompleteRegistration).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.objectContaining({ firstName: 'Ada' }),
    )
  })

  it('returns 400 for malformed JSON in bodyRaw', async () => {
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' }, bodyRaw: '{not json' })

    const result = await handler(ctx)

    expect(result).toEqual({ data: { status: 'error', kind: 'validation', message: 'Invalid JSON body' }, status: 400 })
    expect(mockedCompleteRegistration).not.toHaveBeenCalled()
  })

  it('returns 400 with issues for an empty body (missing required fields)', async () => {
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' } })

    const result = (await handler(ctx)) as { data: unknown; status: number }

    expect(result.status).toBe(400)
    expect(result.data).toMatchObject({ status: 'error', kind: 'validation' })
    expect(mockedCompleteRegistration).not.toHaveBeenCalled()
  })

  it('propagates a ValidationError from parseRegistrationInput as 400 with issues', async () => {
    const ctx = makeContext({
      headers: { 'x-appwrite-user-id': 'user-1' },
      body: { ...VALID_BODY, role: 'admin' },
    })

    const result = (await handler(ctx)) as { data: unknown; status: number }

    expect(result.status).toBe(400)
    expect(result.data).toMatchObject({ status: 'error', kind: 'validation' })
  })

  it('maps ExternalServiceError from completeRegistration to 502 and logs it', async () => {
    mockedCompleteRegistration.mockRejectedValue(new ExternalServiceError('DB unreachable', new Error('cause')))
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' }, body: VALID_BODY })

    const result = await handler(ctx)

    expect(result).toEqual({
      data: { status: 'error', kind: 'external', message: 'DB unreachable' },
      status: 502,
    })
    expect(ctx.error).toHaveBeenCalled()
  })

  it('maps a ValidationError thrown by completeRegistration to 400 with issues', async () => {
    mockedCompleteRegistration.mockRejectedValue(new ValidationError([{ path: 'role', message: 'bad' }]))
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' }, body: VALID_BODY })

    const result = await handler(ctx)

    expect(result).toEqual({
      data: { status: 'error', kind: 'validation', issues: [{ path: 'role', message: 'bad' }] },
      status: 400,
    })
  })

  it('maps an unexpected error to a generic 500 without leaking internals', async () => {
    mockedCompleteRegistration.mockRejectedValue(new Error('something exploded'))
    const ctx = makeContext({ headers: { 'x-appwrite-user-id': 'user-1' }, body: VALID_BODY })

    const result = await handler(ctx)

    expect(result).toEqual({
      data: { status: 'error', kind: 'external', message: 'Unexpected failure' },
      status: 500,
    })
    expect(ctx.error).toHaveBeenCalled()
  })
})
