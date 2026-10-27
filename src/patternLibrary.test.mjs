import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { deletePattern, getPatternFile, listPatterns, loadPatternLibrary, patchPatterns, savePattern } from './patternLibrary.ts'

let legacyStorage
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  legacyStorage = new Map()
  globalThis.localStorage = {
    getItem: (key) => legacyStorage.get(key) ?? null,
    removeItem: (key) => legacyStorage.delete(key),
    setItem: () => { throw new DOMException('Storage full', 'QuotaExceededError') },
  }
})

const pdf = () => new File(['%PDF-test-content'], '上衣-M.pdf', { type: 'application/pdf' })
const record = (id, changes = {}) => ({ id, title: '上衣', size: 'M', fileName: '上衣-M.pdf', cover: 'small-cover', coverLarge: 'large-cover', pageCount: 1, fileSize: pdf().size, tag: '上衣', createdAt: '2026-10-27T00:00:00.000Z', ...changes })
const unexpectedRecovery = () => { throw new Error('Unexpected orphan recovery') }

async function seedOldFiles(entries) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('caifengbao-pattern-library', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pattern-files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('pattern-files', 'readwrite')
    for (const [id, file] of entries) transaction.objectStore('pattern-files').put(file, id)
    transaction.oncomplete = resolve
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
}

test('records, PDF bytes and large covers survive reopening even when localStorage is full', async () => {
  const saved = record('persisted', { coverLarge: 'x'.repeat(6 * 1024 * 1024) })
  await loadPatternLibrary(unexpectedRecovery)
  await savePattern(saved, pdf())
  assert.deepEqual(await loadPatternLibrary(unexpectedRecovery), [saved])
  const restored = await getPatternFile('persisted')
  assert.equal(restored.name, saved.fileName)
  assert.equal(await restored.text(), await pdf().text())
})

test('upgrades v1 and migrates the old catalogue without losing full covers or original PDFs', async () => {
  const legacy = record('legacy')
  legacyStorage.set('caifengbao-patterns', JSON.stringify([legacy]))
  await seedOldFiles([['legacy', pdf()]])
  assert.deepEqual(await loadPatternLibrary(unexpectedRecovery), [legacy])
  assert.equal(await (await getPatternFile('legacy')).text(), await pdf().text())
  assert.equal(legacyStorage.has('caifengbao-patterns'), false)
})

test('recovers orphaned PDFs once, including concurrent startup loads', async () => {
  await seedOldFiles([['orphan', pdf()]])
  let recovered = 0
  const recover = async (id, file) => { recovered++; assert.equal(await file.text(), await pdf().text()); return record(id) }
  const [first, second] = await Promise.all([loadPatternLibrary(recover), loadPatternLibrary(recover)])
  assert.equal(recovered, 1)
  assert.deepEqual(first, second)
  assert.equal((await loadPatternLibrary(recover)).length, 1)
  assert.equal(recovered, 1)
})

test('a failed import rolls back both catalogue and PDF, while previous imports remain', async () => {
  await savePattern(record('previous'), pdf())
  const originalPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function(value, key) {
    if (this.name === 'pattern-records' && key === 'failed') throw new DOMException('Disk full', 'QuotaExceededError')
    return originalPut.call(this, value, key)
  }
  try {
    await assert.rejects(savePattern(record('failed'), pdf()), /之前已保存的纸样仍会保留/)
  } finally { IDBObjectStore.prototype.put = originalPut }
  assert.equal(await getPatternFile('failed'), null)
  assert.deepEqual((await listPatterns()).map((item) => item.id), ['previous'])
  assert.ok(await getPatternFile('previous'))
})

test('metadata edits preserve concurrent fields, covers, and the original PDF', async () => {
  await savePattern(record('edit'), pdf())
  await Promise.all([
    patchPatterns([{ id: 'edit', changes: { title: '修改的名称' } }]),
    patchPatterns([{ id: 'edit', changes: { size: 'XL', tag: '长裙', coverLarge: 'new-cover' } }]),
  ])
  const [edited] = await loadPatternLibrary(unexpectedRecovery)
  assert.equal(edited.title, '修改的名称')
  assert.equal(edited.size, 'XL')
  assert.equal(edited.coverLarge, 'new-cover')
  assert.ok(await getPatternFile('edit'))
})

test('failed batch edits roll back and deleted records cannot reappear from a stale legacy catalogue', async () => {
  const saved = record('deleted')
  await loadPatternLibrary(unexpectedRecovery)
  await savePattern(saved, pdf())
  await assert.rejects(patchPatterns([{ id: 'deleted', changes: { title: '应回滚' } }, { id: 'missing', changes: { size: 'S' } }]))
  assert.equal((await listPatterns())[0].title, saved.title)
  await deletePattern('deleted')
  legacyStorage.set('caifengbao-patterns', JSON.stringify([saved]))
  assert.deepEqual(await loadPatternLibrary(unexpectedRecovery), [])
  assert.equal(await getPatternFile('deleted'), null)
})
