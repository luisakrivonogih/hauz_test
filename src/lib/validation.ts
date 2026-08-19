import { z } from 'zod'

/** E.164: leading +, 1-15 digits total, first digit 1-9. Shared with functions/register-personal-account/src/validation.ts's copy of the same rule. */
export const E164_PATTERN = /^\+[1-9]\d{1,14}$/

export const personalRoleSchema = z.enum(['consumer', 'realtor'])

export const registrationFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
  role: personalRoleSchema,
  contactPhone: z
    .string()
    .trim()
    .regex(E164_PATTERN, 'Enter phone in international format, e.g. +15551234567')
    .max(20)
    .nullish(),
})

export type RegistrationFormValues = z.infer<typeof registrationFormSchema>

export const loginFormSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginFormValues = z.infer<typeof loginFormSchema>
