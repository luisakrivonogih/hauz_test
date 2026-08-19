import { describe, expect, it } from 'vitest'
import { loginFormSchema, registrationFormSchema } from './validation'

describe('registrationFormSchema', () => {
  const base = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    password: 'correct-horse',
    role: 'consumer' as const,
    contactPhone: null,
  }

  it('accepts a fully valid payload', () => {
    const result = registrationFormSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('accepts a valid payload with a realtor role and no phone', () => {
    const result = registrationFormSchema.safeParse({ ...base, role: 'realtor', contactPhone: undefined })
    expect(result.success).toBe(true)
  })

  it('accepts a valid E.164 phone number', () => {
    const result = registrationFormSchema.safeParse({ ...base, contactPhone: '+15551234567' })
    expect(result.success).toBe(true)
  })

  it.each([
    ['missing +', '15551234567'],
    ['leading zero after +', '+05551234567'],
    ['contains letters', '+1555abc4567'],
    ['too long', '+1234567890123456'],
    ['spaces', '+1 555 123 4567'],
  ])('rejects a malformed phone number: %s', (_label, contactPhone) => {
    const result = registrationFormSchema.safeParse({ ...base, contactPhone })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = registrationFormSchema.safeParse({ ...base, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects a password shorter than 8 characters', () => {
    const result = registrationFormSchema.safeParse({ ...base, password: 'short' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty first name', () => {
    const result = registrationFormSchema.safeParse({ ...base, firstName: '  ' })
    expect(result.success).toBe(false)
  })

  it('rejects a role outside consumer/realtor', () => {
    const result = registrationFormSchema.safeParse({ ...base, role: 'admin' })
    expect(result.success).toBe(false)
  })

  it('trims first and last name', () => {
    const result = registrationFormSchema.safeParse({ ...base, firstName: '  Ada  ', lastName: '  Lovelace  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.firstName).toBe('Ada')
      expect(result.data.lastName).toBe('Lovelace')
    }
  })
})

describe('loginFormSchema', () => {
  it('accepts a valid email/password pair', () => {
    expect(loginFormSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true)
  })

  it('rejects an empty password', () => {
    expect(loginFormSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false)
  })

  it('rejects an invalid email', () => {
    expect(loginFormSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false)
  })
})
