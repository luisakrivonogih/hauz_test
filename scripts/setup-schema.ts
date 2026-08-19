/**
 * Idempotent schema setup for a fresh Appwrite project: creates the HAUZ
 * database, its 4 tables with exact columns/indexes from NOTES.md, and
 * seeds the two personal_roles rows.
 *
 * Run with: npm run setup:schema
 *
 * Deliberately has its own env loader instead of importing src/env/server.ts
 * — this is the only place in the repo that reads APPWRITE_API_KEY, and it
 * must stay that way so the key can never end up in the running app's
 * server bundle.
 */
import { randomUUID } from 'node:crypto'
import {
  Client,
  Query,
  RelationMutate,
  RelationshipType,
  TablesDB,
  TablesDBIndexType,
} from 'node-appwrite'
import { z } from 'zod'

const envSchema = z.object({
  VITE_APPWRITE_ENDPOINT: z.url(),
  VITE_APPWRITE_PROJECT_ID: z.string().min(1),
  APPWRITE_API_KEY: z.string().min(1),
  APPWRITE_DATABASE_ID: z.string().min(1),
  APPWRITE_TABLE_ACCOUNTS_ID: z.string().min(1),
  APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID: z.string().min(1),
  APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID: z.string().min(1),
  APPWRITE_TABLE_PERSONAL_ROLES_ID: z.string().min(1),
})

const env = envSchema.parse(process.env)

const client = new Client()
  .setEndpoint(env.VITE_APPWRITE_ENDPOINT)
  .setProject(env.VITE_APPWRITE_PROJECT_ID)
  .setKey(env.APPWRITE_API_KEY)

const tablesDB = new TablesDB(client)

const DATABASE_ID = env.APPWRITE_DATABASE_ID
const ACCOUNTS = env.APPWRITE_TABLE_ACCOUNTS_ID
const GRANTS = env.APPWRITE_TABLE_ACCOUNT_ACCESS_GRANTS_ID
const PERSONAL_ACCOUNTS = env.APPWRITE_TABLE_PERSONAL_ACCOUNTS_ID
const PERSONAL_ROLES = env.APPWRITE_TABLE_PERSONAL_ROLES_ID

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 409
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForColumn(tableId: string, key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const column = (await tablesDB.getColumn({ databaseId: DATABASE_ID, tableId, key })) as {
      status: string
      error?: string
    }
    if (column.status === 'available') return
    if (column.status === 'failed' || column.status === 'stuck') {
      throw new Error(`Column ${tableId}.${key} failed: ${column.error ?? 'unknown error'}`)
    }
    await sleep(500)
  }
  throw new Error(`Timed out waiting for column ${tableId}.${key} to become available`)
}

async function waitForIndex(tableId: string, key: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const index = await tablesDB.getIndex({ databaseId: DATABASE_ID, tableId, key })
    if (index.status === 'available') return
    if (index.status === 'failed' || index.status === 'stuck') {
      throw new Error(`Index ${tableId}.${key} failed: ${index.error}`)
    }
    await sleep(500)
  }
  throw new Error(`Timed out waiting for index ${tableId}.${key} to become available`)
}

async function ensureDatabase(): Promise<void> {
  try {
    await tablesDB.create({ databaseId: DATABASE_ID, name: 'HAUZ' })
    console.log(`[db] created ${DATABASE_ID}`)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    console.log(`[db] ${DATABASE_ID} already exists`)
  }
}

async function ensureTable(tableId: string, name: string): Promise<void> {
  try {
    await tablesDB.createTable({ databaseId: DATABASE_ID, tableId, name, rowSecurity: true })
    console.log(`[table] created ${tableId}`)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    console.log(`[table] ${tableId} already exists`)
  }
}

async function ensureVarcharColumn(
  tableId: string,
  key: string,
  size: number,
  required: boolean,
): Promise<void> {
  try {
    await tablesDB.createVarcharColumn({ databaseId: DATABASE_ID, tableId, key, size, required })
    console.log(`[column] created ${tableId}.${key}`)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    console.log(`[column] ${tableId}.${key} already exists`)
  }
  await waitForColumn(tableId, key)
}

async function ensureEnumColumn(
  tableId: string,
  key: string,
  elements: string[],
  required: boolean,
): Promise<void> {
  try {
    await tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId, key, elements, required })
    console.log(`[column] created ${tableId}.${key}`)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    console.log(`[column] ${tableId}.${key} already exists`)
  }
  await waitForColumn(tableId, key)
}

async function ensureDatetimeColumn(tableId: string, key: string, required: boolean): Promise<void> {
  try {
    await tablesDB.createDatetimeColumn({ databaseId: DATABASE_ID, tableId, key, required })
    console.log(`[column] created ${tableId}.${key}`)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    console.log(`[column] ${tableId}.${key} already exists`)
  }
  await waitForColumn(tableId, key)
}

/**
 * Appwrite relationship columns have no `required` flag — NOT NULL for
 * account_id/role_id can only be enforced by the Function always supplying
 * them, never at the schema level. See NOTES.md open questions.
 */
async function ensureRelationshipColumn(
  tableId: string,
  key: string,
  relatedTableId: string,
  type: RelationshipType,
): Promise<void> {
  try {
    await tablesDB.createRelationshipColumn({
      databaseId: DATABASE_ID,
      tableId,
      relatedTableId,
      type,
      twoWay: false,
      key,
      onDelete: RelationMutate.Restrict,
    })
    console.log(`[column] created ${tableId}.${key} -> ${relatedTableId}`)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    console.log(`[column] ${tableId}.${key} already exists`)
  }
  await waitForColumn(tableId, key)
}

async function ensureIndex(
  tableId: string,
  key: string,
  type: TablesDBIndexType,
  columns: string[],
): Promise<void> {
  try {
    await tablesDB.createIndex({ databaseId: DATABASE_ID, tableId, key, type, columns })
    console.log(`[index] created ${tableId}.${key}`)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    console.log(`[index] ${tableId}.${key} already exists`)
  }
  await waitForIndex(tableId, key)
}

async function ensurePersonalRole(value: 'consumer' | 'realtor'): Promise<void> {
  const existing = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: PERSONAL_ROLES,
    queries: [Query.equal('value', value), Query.limit(1)],
  })
  if (existing.rows.length > 0) {
    console.log(`[seed] personal_roles.value=${value} already exists`)
    return
  }
  await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: PERSONAL_ROLES,
    rowId: randomUUID(),
    data: { value },
  })
  console.log(`[seed] created personal_roles.value=${value}`)
}

async function main(): Promise<void> {
  await ensureDatabase()

  await ensureTable(ACCOUNTS, 'accounts')
  await ensureTable(GRANTS, 'account_access_grants')
  await ensureTable(PERSONAL_ACCOUNTS, 'personal_accounts')
  await ensureTable(PERSONAL_ROLES, 'personal_roles')

  await ensureEnumColumn(ACCOUNTS, 'account_type', ['individual'], true)
  await ensureEnumColumn(ACCOUNTS, 'status', ['active', 'blocked'], true)
  await ensureDatetimeColumn(ACCOUNTS, 'terminated_at', false)
  await ensureVarcharColumn(ACCOUNTS, 'current_access_grant_id', 36, false)

  await ensureVarcharColumn(GRANTS, 'appwrite_user_id', 36, true)
  await ensureRelationshipColumn(GRANTS, 'account_id', ACCOUNTS, RelationshipType.ManyToOne)
  await ensureDatetimeColumn(GRANTS, 'revoked_at', false)

  await ensureRelationshipColumn(PERSONAL_ACCOUNTS, 'account_id', ACCOUNTS, RelationshipType.OneToOne)
  await ensureRelationshipColumn(PERSONAL_ACCOUNTS, 'role_id', PERSONAL_ROLES, RelationshipType.ManyToOne)
  await ensureVarcharColumn(PERSONAL_ACCOUNTS, 'first_name', 100, true)
  await ensureVarcharColumn(PERSONAL_ACCOUNTS, 'last_name', 100, true)
  await ensureVarcharColumn(PERSONAL_ACCOUNTS, 'contact_phone', 20, false)

  await ensureEnumColumn(PERSONAL_ROLES, 'value', ['consumer', 'realtor'], true)

  await ensureIndex(ACCOUNTS, 'ix_accounts_type_status', TablesDBIndexType.Key, [
    'account_type',
    'status',
  ])
  await ensureIndex(ACCOUNTS, 'ix_accounts_terminated', TablesDBIndexType.Key, ['terminated_at'])

  await ensureIndex(GRANTS, 'ix_grants_user_access', TablesDBIndexType.Key, [
    'appwrite_user_id',
    'revoked_at',
  ])
  await ensureIndex(GRANTS, 'ix_grants_account_history', TablesDBIndexType.Key, [
    'account_id',
    'revoked_at',
  ])
  await ensureIndex(GRANTS, 'ix_grants_user_account', TablesDBIndexType.Key, [
    'appwrite_user_id',
    'account_id',
    'revoked_at',
  ])

  await ensureIndex(PERSONAL_ACCOUNTS, 'uq_personal_account', TablesDBIndexType.Unique, [
    'account_id',
  ])
  await ensureIndex(PERSONAL_ACCOUNTS, 'ix_personal_role', TablesDBIndexType.Key, ['role_id'])
  await ensureIndex(PERSONAL_ACCOUNTS, 'ix_personal_contact_phone', TablesDBIndexType.Key, [
    'contact_phone',
  ])

  await ensureIndex(PERSONAL_ROLES, 'uq_personal_roles_value', TablesDBIndexType.Unique, ['value'])

  await ensurePersonalRole('consumer')
  await ensurePersonalRole('realtor')

  console.log('\nSchema setup complete.')
}

main().catch((error: unknown) => {
  console.error('\nSchema setup failed:', error)
  process.exit(1)
})
