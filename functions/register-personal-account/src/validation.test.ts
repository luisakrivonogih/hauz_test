import { describe, expect, it } from 'vitest'
import { ValidationError } from './errors.js'
import { parseRegistrationInput } from './validation.js'

describe('parseRegistrationInput', () => {
  const valid = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'consumer',
    contactPhone: '+15551234567',
  }

  it('accepts a fully valid payload', () => {
    const result = parseRegistrationInput(valid)
    expect(result).toEqual(valid)
  })

  it('defaults a missing contactPhone to null', () => {
    const { contactPhone, ...rest } = valid
    const result = parseRegistrationInput(rest)
    expect(result.contactPhone).toBeNull()
  })

  it('accepts an explicit null contactPhone', () => {
    const result = parseRegistrationInput({ ...valid, contactPhone: null })
    expect(result.contactPhone).toBeNull()
  })

  it('throws ValidationError for an invalid role', () => {
    expect(() => parseRegistrationInput({ ...valid, role: 'admin' })).toThrow(ValidationError)
  })

  it('throws ValidationError for a malformed phone number', () => {
    expect(() => parseRegistrationInput({ ...valid, contactPhone: '5551234567' })).toThrow(ValidationError)
  })

  it('throws ValidationError for a missing firstName', () => {
    const { firstName: _firstName, ...rest } = valid
    expect(() => parseRegistrationInput(rest)).toThrow(ValidationError)
  })

  it('includes structured issues on the thrown error', () => {
    try {
      parseRegistrationInput({ ...valid, role: 'admin' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).issues.length).toBeGreaterThan(0)
    }
  })
})
