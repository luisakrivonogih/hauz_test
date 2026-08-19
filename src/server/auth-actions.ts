import { AppwriteException, ID } from 'node-appwrite'
import { getServerEnv } from '@/env/server'
import type { LoginFormValues, RegistrationFormValues } from '@/lib/validation'
import { conflictError, externalError, ok, validationError } from '@/lib/result'
import type { ActionResult } from '@/lib/result'
import { createSessionAppwriteClient } from './appwrite-session'
import { resolveAuthState } from './auth-state'
import type { AuthState, HauzUserPrefs } from './auth-state'
import { invokeRegisterFunction } from './register-function'
import { clearSessionSecret, readSessionSecret, writeSessionSecret } from './session-cookie'

/**
 * The actual auth business logic, kept as plain functions with no
 * `createServerFn` wrapper — that wrapper needs a Start context that only
 * exists inside TanStack Start's real request runtime (an AsyncLocalStorage
 * it sets up per-request), so it can't run in a plain unit test. Plain
 * functions here are directly testable; src/server-fns/auth.ts just wires
 * each one to a validated HTTP-ish entry point.
 */

function isConflict(error: unknown): boolean {
  return error instanceof AppwriteException && error.code === 409
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof AppwriteException && (error.code === 401 || error.code === 400)
}

export async function authStateAction(): Promise<AuthState> {
  return resolveAuthState()
}

export async function registerAction(data: RegistrationFormValues): Promise<ActionResult<{ email: string }>> {
  const env = getServerEnv()
  const { client, account } = createSessionAppwriteClient()

  try {
    await account.create({
      userId: ID.unique(),
      email: data.email,
      password: data.password,
      name: `${data.firstName} ${data.lastName}`,
    })
  } catch (error) {
    if (isConflict(error)) {
      return conflictError('An account with this email already exists. Try logging in instead.')
    }
    return externalError('Failed to create account. Please try again.')
  }

  try {
    const session = await account.createEmailPasswordSession({
      email: data.email,
      password: data.password,
    })
    client.setSession(session.secret)
    // Set the cookie the moment a session exists: everything past this
    // point is best-effort, and the next screen (unverified, with a
    // resend button) is the recovery path if any of it fails — leaving
    // the user on this form with no session would be a dead end instead,
    // since re-submitting would now hit the "email already exists" case.
    writeSessionSecret(session.secret)
  } catch {
    // Account was created but we couldn't start a session for it. The user
    // can still finish via the login screen — the Auth user already exists.
    return externalError('Account created, but signing you in failed. Please log in.')
  }

  await account
    .updatePrefs<HauzUserPrefs>({
      prefs: {
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        contactPhone: data.contactPhone ?? null,
      },
    })
    .catch(() => undefined)

  await account.createVerification({ url: `${env.VITE_APP_URL}/verify-email` }).catch(() => undefined)

  return ok({ email: data.email })
}

export async function resendVerificationAction(): Promise<ActionResult<null>> {
  const env = getServerEnv()
  const secret = readSessionSecret()
  if (!secret) return externalError('You need to be signed in to resend a verification email.')

  const { account } = createSessionAppwriteClient(secret)
  try {
    await account.createVerification({ url: `${env.VITE_APP_URL}/verify-email` })
    return ok(null)
  } catch {
    return externalError('Failed to send verification email. Please try again shortly.')
  }
}

export async function verifyEmailAction(data: {
  userId: string
  secret: string
}): Promise<ActionResult<{ hasSession: boolean }>> {
  const { account } = createSessionAppwriteClient()
  try {
    await account.updateVerification({ userId: data.userId, secret: data.secret })
    // The link may be opened on a different device/browser than the one
    // that registered — only redirect into the session-resolving `/`
    // dispatcher if this browser actually has our cookie; otherwise send
    // them to log in, rather than bouncing through /register's
    // already-exists conflict first.
    return ok({ hasSession: Boolean(readSessionSecret()) })
  } catch (error) {
    if (isUnauthorized(error)) {
      return validationError([], 'This verification link is invalid or has expired.')
    }
    return externalError('Failed to verify email. Please try again.')
  }
}

export async function loginAction(data: LoginFormValues): Promise<ActionResult<null>> {
  const { account } = createSessionAppwriteClient()
  try {
    const session = await account.createEmailPasswordSession({
      email: data.email,
      password: data.password,
    })
    writeSessionSecret(session.secret)
    return ok(null)
  } catch (error) {
    if (isUnauthorized(error)) {
      return validationError([], 'Incorrect email or password.')
    }
    return externalError('Login failed. Please try again.')
  }
}

export async function logoutAction(): Promise<ActionResult<null>> {
  const secret = readSessionSecret()
  if (secret) {
    const { account } = createSessionAppwriteClient(secret)
    await account.deleteSession({ sessionId: 'current' }).catch(() => undefined)
  }
  clearSessionSecret()
  return ok(null)
}

export async function finishRegistrationAction(): Promise<ActionResult<{ accountId: string }>> {
  const env = getServerEnv()
  const secret = readSessionSecret()
  if (!secret) return externalError('You need to be signed in to finish registration.')

  const { account, functions } = createSessionAppwriteClient(secret)

  let prefs: HauzUserPrefs
  try {
    const user = await account.get<HauzUserPrefs>()
    if (!user.emailVerification) {
      return validationError([], 'Please verify your email before finishing registration.')
    }
    prefs = user.prefs
  } catch {
    return externalError('Failed to load your account. Please try again.')
  }

  const result = await invokeRegisterFunction(functions, env.APPWRITE_FUNCTION_REGISTER_PERSONAL_ACCOUNT_ID, {
    firstName: prefs.firstName,
    lastName: prefs.lastName,
    role: prefs.role,
    contactPhone: prefs.contactPhone,
  })

  if (!result.ok) {
    return result.kind === 'validation' ? validationError([], result.message) : externalError(result.message)
  }

  return ok({ accountId: result.accountId })
}
