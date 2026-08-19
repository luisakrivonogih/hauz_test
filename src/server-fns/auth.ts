import { createServerFn } from '@tanstack/react-start'
import { loginFormSchema, registrationFormSchema } from '@/lib/validation'
import {
  authStateAction,
  finishRegistrationAction,
  loginAction,
  logoutAction,
  registerAction,
  resendVerificationAction,
  verifyEmailAction,
} from '@/server/auth-actions'

/** Resolves the current auth/registration state — the loaders' single source of truth. */
export const authStateFn = createServerFn({ method: 'GET' }).handler(authStateAction)

export const registerFn = createServerFn({ method: 'POST' })
  .validator(registrationFormSchema)
  .handler(({ data }) => registerAction(data))

export const resendVerificationFn = createServerFn({ method: 'POST' }).handler(resendVerificationAction)

export const verifyEmailFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => {
    const input = raw as { userId?: unknown; secret?: unknown }
    if (typeof input.userId !== 'string' || typeof input.secret !== 'string') {
      throw new Error('Missing verification parameters')
    }
    return { userId: input.userId, secret: input.secret }
  })
  .handler(({ data }) => verifyEmailAction(data))

export const loginFn = createServerFn({ method: 'POST' })
  .validator(loginFormSchema)
  .handler(({ data }) => loginAction(data))

export const logoutFn = createServerFn({ method: 'POST' }).handler(logoutAction)

export const finishRegistrationFn = createServerFn({ method: 'POST' }).handler(finishRegistrationAction)
