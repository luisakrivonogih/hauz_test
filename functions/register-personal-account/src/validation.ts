import { z } from 'zod'
import { ValidationError } from './errors.js'

/** E.164: leading +, 1-15 digits total, first digit 1-9. */
const E164_PATTERN = /^\+[1-9]\d{1,14}$/

const registrationInputSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(['consumer', 'realtor']),
  contactPhone: z
    .string()
    .trim()
    .regex(E164_PATTERN, 'contactPhone must be in E.164 format, e.g. +15551234567')
    .max(20)
    .nullish(),
})

export type RegistrationInput = {
  firstName: string
  lastName: string
  role: 'consumer' | 'realtor'
  contactPhone: string | null
}

export function parseRegistrationInput(raw: unknown): RegistrationInput {
  const result = registrationInputSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    )
  }
  return {
    firstName: result.data.firstName,
    lastName: result.data.lastName,
    role: result.data.role,
    contactPhone: result.data.contactPhone ?? null,
  }
}
