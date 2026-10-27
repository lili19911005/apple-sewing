import type { PatternRecord } from './patternTypes'

const DB_NAME = 'caifengbao-pattern-library'
const FILES = 'pattern-files'
const RECORDS = 'pattern-records'
const SETTINGS = 'settings'
const LEGACY_KEY = 'caifengbao-patterns'
const DB_VERSION = 2

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      for (const name of [FILES, RECORDS, SETTINGS]) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name)
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('纸样数据库打开失败。'))
    request.onblocked = () => reject(new Error('请关闭其他旧版本网页后重试，纸样数据库需要升级。'))
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(stores: string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<T> | T) {
  const database = await openDatabase()
  try {
    // Ask supporting browsers to flush writes before reporting success.
    const transaction = database.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined)
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('纸样保存未完成，请重试。'))
      transaction.onerror = () => { /* The abort event reports the final transaction failure. */ }
    })
    try {
      const result = await operation(transaction)
      await completed
      return result
    } catch (error) {
      try { transaction.abort() } catch { /* It may already have aborted. */ }
      await completed.catch(() => {})
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new Error('本地存储空间不足，本次保存未完成，之前已保存的纸样仍会保留。请先导出备份并释放空间。')
      }
      throw error
    }
  } finally { database.close() }
}

function fileFromStored(value: unknown, name = '未命名纸样.pdf'): File | null {
  if (value instanceof File) return value
  // Some browser engines restore a structured-cloned File as a Blob.
  if (value instanceof Blob) return new File([value], name, { type: value.type || 'application/pdf' })
  return null
}

export function savePattern(record: PatternRecord, file: File) {
  // A PDF and its catalogue entry either both commit or neither does.
  return transact([FILES, RECORDS], 'readwrite', (transaction) => {
    transaction.objectStore(FILES).put(file, record.id)
    transaction.objectStore(RECORDS).put(record, record.id)
  })
}

export function getPatternFile(id: string) {
  return transact([FILES, RECORDS], 'readonly', async (transaction) => {
    const [value, record] = await Promise.all([
      requestResult(transaction.objectStore(FILES).get(id)),
      requestResult<PatternRecord | undefined>(transaction.objectStore(RECORDS).get(id)),
    ])
    return fileFromStored(value, record?.fileName)
  })
}

export function deletePattern(id: string) {
  return transact([FILES, RECORDS], 'readwrite', (transaction) => {
    transaction.objectStore(FILES).delete(id)
    transaction.objectStore(RECORDS).delete(id)
  })
}

export function patchPatterns(updates: { id: string; changes: Partial<PatternRecord> }[]) {
  return transact([RECORDS], 'readwrite', async (transaction) => {
    const store = transaction.objectStore(RECORDS)
    await Promise.all(updates.map(async ({ id, changes }) => {
      const existing = await requestResult<PatternRecord | undefined>(store.get(id))
      if (!existing) throw new Error('纸样记录已不存在，请刷新纸样库后重试。')
      store.put({ ...existing, ...changes, id }, id)
    }))
  })
}

async function migrateLegacyRecords() {
  let legacy: PatternRecord[] = []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]')
    if (Array.isArray(value)) legacy = value.filter((item) => item && typeof item.id === 'string' && typeof item.fileName === 'string')
  } catch { /* Recover PDFs from the old database even if the old catalogue is unreadable. */ }
  await transact([RECORDS, SETTINGS], 'readwrite', async (transaction) => {
    const settings = transaction.objectStore(SETTINGS)
    if (await requestResult(settings.get('legacy-catalogue-migrated'))) return
    const records = transaction.objectStore(RECORDS)
    await Promise.all(legacy.map(async (record) => {
      if (!await requestResult(records.get(record.id))) records.put(record, record.id)
    }))
    settings.put(true, 'legacy-catalogue-migrated')
  })
  // Never remove the old catalogue until the entire migration has committed.
  try { localStorage.removeItem(LEGACY_KEY) } catch { /* Storage may be unavailable. */ }
}

export function listPatterns() {
  return transact([RECORDS], 'readonly', async (transaction) => {
    const records = await requestResult<PatternRecord[]>(transaction.objectStore(RECORDS).getAll())
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  })
}

let loading: Promise<PatternRecord[]> | undefined
export function loadPatternLibrary(recover: (id: string, file: File) => Promise<PatternRecord>) {
  // React StrictMode can mount twice; migrate and recover once per concurrent load.
  loading ??= (async () => {
    await migrateLegacyRecords()
    const orphanIds = await transact([FILES, RECORDS], 'readonly', async (transaction) => {
      const [fileIds, recordIds] = await Promise.all([
        requestResult(transaction.objectStore(FILES).getAllKeys()),
        requestResult(transaction.objectStore(RECORDS).getAllKeys()),
      ])
      const known = new Set(recordIds)
      return fileIds.filter((id): id is string => typeof id === 'string' && !known.has(id))
    })
    for (const id of orphanIds) {
      const file = await getPatternFile(id)
      if (!file) continue
      const record = await recover(id, file)
      await transact([FILES, RECORDS], 'readwrite', async (transaction) => {
        // Another tab may have already recovered or deleted this entry.
        const [exists, storedFile] = await Promise.all([
          requestResult(transaction.objectStore(RECORDS).get(id)),
          requestResult(transaction.objectStore(FILES).get(id)),
        ])
        if (!exists && storedFile) transaction.objectStore(RECORDS).put(record, id)
      })
    }
    return listPatterns()
  })().finally(() => { loading = undefined })
  return loading
}

export async function requestPatternPersistence() {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch { return false }
}
