const DB_NAME = 'caifengbao-pattern-library'
const STORE_NAME = 'pattern-files'
const DB_VERSION = 1

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('纸样数据库打开失败。'))
  })
}

export async function savePatternFile(id: string, file: File) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(file, id)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('纸样 PDF 保存失败。')) }
  })
}

export async function getPatternFile(id: string) {
  const database = await openDatabase()
  return new Promise<File | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    request.onsuccess = () => { database.close(); resolve(request.result instanceof File ? request.result : null) }
    request.onerror = () => { database.close(); reject(request.error ?? new Error('纸样 PDF 读取失败。')) }
  })
}

export async function deletePatternFile(id: string) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(id)
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('纸样 PDF 删除失败。')) }
  })
}
