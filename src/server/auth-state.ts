import { Query } from 'node-appwrite'
import type { Models } from 'node-appwrite'
import { getServerEnv } from '@/env/server'
import { relatedId } from '@/types/hauz'
import type { AccountAccessGrantRow, PersonalAccountRow, PersonalRoleValue } from '@/types/hauz'
import { createSessionAppwriteClient } from './appwrite-session'
import { clearSessionSecret, readSessionSecret } from './session-cookie'

/** Registration profile fields, stashed on the Auth user's own prefs at signup so they survive until the HAUZ chain is created — see NOTES.md section 11. */
export interface HauzUserPrefs extends Models.Preferences {
  firstName: string
  lastName: string
  role: PersonalRoleValue
  contactPhone: string | null
}

export type AuthState =
  | { kind: 'anonymous' }
  | { kind: 'unverified'; email: string }
  | { kind: 'needsCompletion'; email: string; prefs: HauzUserPrefs }
  | {
      kind: 'authenticated'
      email: string
      firstName: string
      lastName: string
      role: PersonalRoleValue
      contactPhone: string | null
    }

/**
 * Resolves which of the 4 states from NOTES.md section 6 the current
 * request is in. This is the single source of truth loaders and server
 * functions use to decide what to show/allow — never trust a client-sent
 * flag for this.
 */
export async function resolveAuthState(): Promise<AuthState> {
  const secret = readSessionSecret()
  if (!secret) return { kind: 'anonymous' }

  const { account, tablesDB } = createSessionAppwriteClient(secret)

  let user: Models.User<HauzUserPrefs>
  try {
    user = await account.get<HauzUserPrefs>()
  } catch {
    clearSessionSecret()
    return { kind: 'anonymous' }
  }

  if (!user.emailVerification) {
    return { kind: 'unverified', email: user.email }
  }

  const env = getServerEnv()

  const grants = await tablesDB.listRows<AccountAccessGrantRow>({
    databaseId: env.APPWRITE_DATABASE_ID,
    tableId: env.APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID,
    queries: [Query.equal('appwrite_user_id', user.$id), Query.isNull('revoked_at'), Query.limit(1)],
  })
  const grant = grants.rows[0]

  if (!grant) {
    return { kind: 'needsCompletion', email: user.email, prefs: user.prefs }
  }

  const personalAccounts = await tablesDB.listRows<PersonalAccountRow>({
    databaseId: env.APPWRITE_DATABASE_ID,
    tableId: env.APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID,
    queries: [Query.equal('account_id', relatedId(grant.account_id)), Query.limit(1)],
  })

  if (personalAccounts.rows.length === 0) {
    // Grant exists but the profile row doesn't — a prior finish-registration
    // attempt was interrupted. Route back through completion; the Function
    // call is idempotent and will finish just the missing step.
    return { kind: 'needsCompletion', email: user.email, prefs: user.prefs }
  }

  return {
    kind: 'authenticated',
    email: user.email,
    firstName: user.prefs.firstName,
    lastName: user.prefs.lastName,
    role: user.prefs.role,
    contactPhone: user.prefs.contactPhone,
  }
}
