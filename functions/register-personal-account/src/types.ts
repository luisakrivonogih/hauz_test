/**
 * Local copy of the row shapes this Function touches (see src/types/hauz.ts
 * at the repo root). Duplicated on purpose: this folder is deployed to
 * Appwrite as a standalone unit (zip-and-upload or `appwrite push`), so it
 * must not depend on files outside itself.
 */

export type PersonalRoleValue = 'consumer' | 'realtor'

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
  account_type: 'individual'
  status: 'active' | 'blocked'
  terminated_at: string | null
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

/** Appwrite returns relationship fields as either the plain related $id or the expanded row, depending on the query. Normalize defensively either way. */
export function relatedId(value: string | { $id: string }): string {
  return typeof value === 'string' ? value : value.$id
}
