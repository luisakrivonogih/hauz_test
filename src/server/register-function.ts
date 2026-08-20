import type { Functions } from 'node-appwrite'
import type { PersonalRoleValue } from '@/types/hauz'

export interface RegistrationProfile {
  firstName: string
  lastName: string
  role: PersonalRoleValue
  contactPhone: string | null
}

export type RegisterFunctionResult =
  | { ok: true; status: 'created' | 'already_registered'; accountId: string }
  | { ok: false; kind: 'validation' | 'external'; message: string }

/**
 * Invokes the register-personal-account Appwrite Function using the caller's
 * own session (not an API key) — the Function is what holds write access,
 * this call just triggers it. See functions/register-personal-account.
 */
export async function invokeRegisterFunction(
  functions: Functions,
  functionId: string,
  profile: RegistrationProfile,
): Promise<RegisterFunctionResult> {
  let execution: Awaited<ReturnType<Functions['createExecution']>>
  try {
    execution = await functions.createExecution({
      functionId,
      body: JSON.stringify(profile),
      async: false,
    })
  } catch (error) {
    console.error('invokeRegisterFunction: createExecution failed', error)
    return { ok: false, kind: 'external', message: 'Failed to reach the registration function' }
  }

  let payload: unknown
  try {
    payload = execution.responseBody ? JSON.parse(execution.responseBody) : {}
  } catch {
    return { ok: false, kind: 'external', message: 'Registration function returned an invalid response' }
  }

  if (
    execution.responseStatusCode === 200 || execution.responseStatusCode === 201
  ) {
    const body = payload as { status: 'created' | 'already_registered'; accountId: string }
    return { ok: true, status: body.status, accountId: body.accountId }
  }

  const body = payload as { kind?: 'validation' | 'external'; message?: string }
  return {
    ok: false,
    kind: body.kind === 'validation' ? 'validation' : 'external',
    message: body.message ?? `Registration function failed with status ${execution.responseStatusCode}`,
  }
}
