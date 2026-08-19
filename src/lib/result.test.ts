import { describe, expect, it } from 'vitest'
import { conflictError, externalError, ok, validationError } from './result'

describe('result helpers', () => {
  it('ok() wraps data in a success result', () => {
    expect(ok({ id: '1' })).toEqual({ ok: true, data: { id: '1' } })
  })

  it('validationError() carries issues and an optional message', () => {
    const issues = [{ path: 'email', message: 'Invalid email' }]
    expect(validationError(issues)).toEqual({ ok: false, kind: 'validation', issues, message: undefined })
    expect(validationError(issues, 'Bad input')).toEqual({
      ok: false,
      kind: 'validation',
      issues,
      message: 'Bad input',
    })
  })

  it('conflictError() carries a message', () => {
    expect(conflictError('already exists')).toEqual({ ok: false, kind: 'conflict', message: 'already exists' })
  })

  it('externalError() carries a message', () => {
    expect(externalError('upstream failed')).toEqual({
      ok: false,
      kind: 'external',
      message: 'upstream failed',
    })
  })
})
