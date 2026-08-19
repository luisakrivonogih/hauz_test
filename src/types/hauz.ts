/**
 * TypeScript mirror of the HAUZ Authentication schema (see NOTES.md).
 * Schema is final — these types must stay a 1:1 reflection of it, not grow
 * fields the schema doesn't have.
 *
 * Relationship fields (`account_id`, `role_id`) are typed as `string |
 * { $id: string }` because Appwrite returns either the plain related $id or
 * the expanded related row depending on the query — use `relatedId()` below
 * to normalize either shape instead of assuming one.
 */

export type PersonalRoleValue = 'consumer' | 'realtor'

export type AccountType = 'individual'

export type AccountStatus = 'active' | 'blocked'

/** Fields Appwrite attaches to every row; not part of the HAUZ schema itself. */
export interface AppwriteRowMeta {
  $id: string
  $createdAt: string
  $updatedAt: string
  $sequence: string
  $databaseId: string
  $tableId: string
  $permissions: string[]
}

export interface AccountRow extends AppwriteRowMeta {
  account_type: AccountType
  status: AccountStatus
  terminated_at: string | null
  /** Plain string field storing an account_access_grants.$id — NOT a relationship. */
  current_access_grant_id: string | null
}

export interface AccountAccessGrantRow extends AppwriteRowMeta {
  appwrite_user_id: string
  account_id: string | { $id: string }
  revoked_at: string | null
}

export interface PersonalAccountRow extends AppwriteRowMeta {
  account_id: string | { $id: string }
  role_id: string | { $id: string }
  first_name: string
  last_name: string
  contact_phone: string | null
}

export interface PersonalRoleRow extends AppwriteRowMeta {
  value: PersonalRoleValue
}

/** Payload shape for creating a row: every HAUZ field except the ones Appwrite assigns itself. */
export type NewRow<T extends AppwriteRowMeta> = Omit<T, keyof AppwriteRowMeta>

export type NewAccountRow = NewRow<AccountRow>
export type NewAccountAccessGrantRow = NewRow<AccountAccessGrantRow>
export type NewPersonalAccountRow = NewRow<PersonalAccountRow>
export type NewPersonalRoleRow = NewRow<PersonalRoleRow>

/** Appwrite returns relationship fields as either the plain related $id or the expanded row, depending on the query. Normalize defensively either way. */
export function relatedId(value: string | { $id: string }): string {
  return typeof value === 'string' ? value : value.$id
}
