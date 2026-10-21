import { BUILTIN_CATALOG, CATALOG_VERSION } from "./message-catalog.js"
import { LIBRARY_STORAGE_KEY, PAGE_SIZE, editLibrary, loadLibrary } from "./quick-messages.js"

export const DATABASE_NAME = "quick-message-keyboard.sqlite"

const schema = `
CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, enabled INTEGER NOT NULL,
  position INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id),
  text TEXT NOT NULL, answer TEXT, scene TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS category_title ON categories(title) WHERE deleted = 0;
CREATE UNIQUE INDEX IF NOT EXISTS message_text ON messages(category_id, text) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS message_page ON messages(category_id, deleted, position, id);
`

const categoryInsert = "INSERT OR IGNORE INTO categories (id, title, enabled, position, deleted) VALUES (?, ?, ?, ?, ?)"
const messageInsert = "INSERT OR IGNORE INTO messages (id, category_id, text, answer, scene, position, deleted) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)"
const preferenceSave = "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
const legacyCounts = { valorant: 24, comebacks: 10, jokes: 10, riddles: 10, banter: 10, praise: 8, daily: 10 }

function appendCategory(steps, category, position, deleted = 0) {
  steps.push({ sql: categoryInsert, args: [category.id, category.title, category.enabled ? 1 : 0, position, deleted] })
  for (const [index, message] of category.messages.entries()) {
    steps.push({ sql: messageInsert, args: [message.id, category.id, message.text, message.answer || null, message.scene || "", index, deleted, category.id] })
  }
}

async function readPreferences(db) {
  return Object.fromEntries((await db.fetchAll("SELECT key, value FROM preferences")).map((row) => [row.key, row.value]))
}

// The same interface is used by native Scripting SQLite and the real-SQLite tests.
export async function openMessageStore(db, legacy, catalog = BUILTIN_CATALOG, catalogVersion = CATALOG_VERSION) {
  await db.execute(schema)
  const columns = await db.fetchAll("PRAGMA table_info(messages)")
  if (!columns.some((column) => column.name === "scene")) await db.execute("ALTER TABLE messages ADD COLUMN scene TEXT NOT NULL DEFAULT ''")
  const preferences = await readPreferences(db)
  const previousCatalogVersion = Number(preferences.catalogVersion || 0)
  if (Number(preferences.catalogVersion || 0) < catalogVersion) {
    const steps = []
    const migrating = !preferences.catalogVersion && legacy?.version === 1 && Array.isArray(legacy.categories) && legacy.categories.length > 0
    if (migrating) {
      const previous = loadLibrary(legacy)
      previous.categories.forEach((category, index) => appendCategory(steps, category, index))
      // Tombstones preserve deletions from the 82-message shared-storage version.
      catalog.forEach((category, index) => {
        const existing = previous.categories.find((item) => item.id === category.id)
        if (!existing) appendCategory(steps, category, index, 1)
        else for (const [messageIndex, message] of category.messages.entries()) {
          if (messageIndex >= (legacyCounts[category.id] || 0) || existing.messages.some((item) => item.id === message.id)) continue
          steps.push({ sql: messageInsert, args: [message.id, category.id, message.text, message.answer || null, message.scene || "", messageIndex, 1, category.id] })
        }
      })
      steps.push({ sql: "INSERT OR IGNORE INTO preferences (key, value) VALUES (?, ?)", args: ["defaultCategoryId", previous.defaultCategoryId] })
      steps.push({ sql: "INSERT OR IGNORE INTO preferences (key, value) VALUES (?, ?)", args: ["soundEnabled", String(previous.soundEnabled)] })
    }
    catalog.forEach((category, index) => appendCategory(steps, category, index))
    if (previousCatalogVersion < 3 && catalogVersion >= 3) {
      for (const category of catalog) for (const message of category.messages) {
        if (message.scene) steps.push({ sql: "UPDATE messages SET scene = ? WHERE id = ? AND scene = ''", args: [message.scene, message.id] })
      }
    }
    steps.push(
      { sql: "INSERT OR IGNORE INTO preferences (key, value) VALUES ('defaultCategoryId', 'valorant')" },
      { sql: "INSERT OR IGNORE INTO preferences (key, value) VALUES ('soundEnabled', 'true')" },
      { sql: preferenceSave, args: ["catalogVersion", String(catalogVersion)] },
    )
    await db.transaction(steps, { kind: "immediate" })
  }

  async function readLibrary() {
    const [categories, messages, prefs] = await Promise.all([
      db.fetchAll("SELECT id, title, enabled FROM categories WHERE deleted = 0 ORDER BY position, id"),
      db.fetchAll("SELECT m.id, m.category_id, m.text, m.answer, m.scene FROM messages m JOIN categories c ON c.id = m.category_id WHERE m.deleted = 0 AND c.deleted = 0 ORDER BY m.position, m.id"),
      readPreferences(db),
    ])
    const grouped = new Map()
    for (const message of messages) {
      if (!grouped.has(message.category_id)) grouped.set(message.category_id, [])
      grouped.get(message.category_id).push({ id: message.id, text: message.text, ...(message.answer ? { answer: message.answer } : {}), ...(message.scene ? { scene: message.scene } : {}) })
    }
    return loadLibrary({ version: 1, defaultCategoryId: prefs.defaultCategoryId, soundEnabled: prefs.soundEnabled !== "false", categories: categories.map((category) => ({
      id: category.id, title: category.title, enabled: Boolean(category.enabled), messages: grouped.get(category.id) || [],
    })) })
  }

  async function readPage(categoryId, pageIndex = 0) {
    const [rows, prefs] = await Promise.all([
      db.fetchAll("SELECT c.id, c.title, COUNT(m.id) AS count FROM categories c LEFT JOIN messages m ON m.category_id = c.id AND m.deleted = 0 WHERE c.deleted = 0 AND c.enabled = 1 GROUP BY c.id ORDER BY c.position, c.id"),
      readPreferences(db),
    ])
    const categories = rows.map((row) => ({ id: row.id, title: row.title, enabled: true, count: Number(row.count) }))
    const category = categories.find((item) => item.id === categoryId)
      || categories.find((item) => item.id === prefs.defaultCategoryId && item.count > 0)
      || categories.find((item) => item.count > 0) || categories[0]
    if (!category) return { categories, categoryId: "", title: "暂无分类", messages: [], index: 0, pageCount: 1, total: 0, soundEnabled: prefs.soundEnabled !== "false" }
    const pageCount = Math.max(1, Math.ceil(category.count / PAGE_SIZE))
    const index = Math.max(0, Math.min(pageCount - 1, Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0))
    const messages = await db.fetchAll("SELECT id, text, answer FROM messages WHERE category_id = ? AND deleted = 0 ORDER BY position, id LIMIT ? OFFSET ?", [category.id, PAGE_SIZE, index * PAGE_SIZE])
    return {
      categories, categoryId: category.id, title: category.title,
      messages: messages.map((message) => ({ id: message.id, text: message.text, ...(message.answer ? { answer: message.answer } : {}) })),
      index, pageCount, total: category.count, soundEnabled: prefs.soundEnabled !== "false",
    }
  }

  async function readScenes(categoryId) {
    const rows = await db.fetchAll("SELECT m.scene, COUNT(*) AS count, MIN(m.position) AS first_position FROM messages m JOIN categories c ON c.id = m.category_id WHERE m.category_id = ? AND m.deleted = 0 AND c.deleted = 0 AND c.enabled = 1 GROUP BY m.scene ORDER BY first_position, m.scene", [categoryId])
    const total = rows.reduce((sum, row) => sum + Number(row.count), 0)
    return [{ id: "all", title: "全部随机", count: total }, ...rows.filter((row) => row.scene).map((row) => ({ id: row.scene, title: row.scene, count: Number(row.count) }))]
  }

  async function readSceneMessages(categoryId, sceneId = "all") {
    const sql = sceneId === "all"
      ? "SELECT id, text, answer, scene FROM messages WHERE category_id = ? AND deleted = 0 ORDER BY position, id"
      : "SELECT id, text, answer, scene FROM messages WHERE category_id = ? AND scene = ? AND deleted = 0 ORDER BY position, id"
    const rows = await db.fetchAll(sql, sceneId === "all" ? [categoryId] : [categoryId, sceneId])
    return rows.map((message) => ({ id: message.id, text: message.text, ...(message.answer ? { answer: message.answer } : {}), ...(message.scene ? { scene: message.scene } : {}) }))
  }

  async function applyChange(change) {
    const before = await readLibrary()
    const after = editLibrary(before, change)
    const steps = []
    const oldCategories = new Map(before.categories.map((category) => [category.id, category]))
    const newIds = new Set(after.categories.map((category) => category.id))
    for (const category of before.categories) {
      if (newIds.has(category.id)) continue
      steps.push({ sql: "UPDATE categories SET deleted = 1 WHERE id = ?", args: [category.id] })
      steps.push({ sql: "UPDATE messages SET deleted = 1 WHERE category_id = ?", args: [category.id] })
    }
    for (const category of after.categories) {
      const previous = oldCategories.get(category.id)
      if (!previous || previous.title !== category.title || previous.enabled !== category.enabled) steps.push({
        sql: "INSERT INTO categories (id, title, enabled, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM categories)) ON CONFLICT(id) DO UPDATE SET title = excluded.title, enabled = excluded.enabled, deleted = 0",
        args: [category.id, category.title, category.enabled ? 1 : 0],
      })
      const oldMessages = new Map((previous?.messages || []).map((message) => [message.id, message]))
      const newMessageIds = new Set(category.messages.map((message) => message.id))
      for (const message of previous?.messages || []) {
        if (!newMessageIds.has(message.id)) steps.push({ sql: "UPDATE messages SET deleted = 1 WHERE id = ?", args: [message.id] })
      }
      for (const message of category.messages) {
        const old = oldMessages.get(message.id)
        if (old && old.text === message.text && old.answer === message.answer && old.scene === message.scene) continue
        steps.push({
          sql: "INSERT INTO messages (id, category_id, text, answer, scene, position) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE category_id = ?)) ON CONFLICT(id) DO UPDATE SET text = excluded.text, answer = excluded.answer, scene = excluded.scene, deleted = 0",
          args: [message.id, category.id, message.text, message.answer || null, message.scene || "", category.id],
        })
      }
    }
    for (const key of ["defaultCategoryId", "soundEnabled"]) {
      if (before[key] !== after[key]) steps.push({ sql: preferenceSave, args: [key, String(after[key])] })
    }
    if (steps.length) await db.transaction(steps, { kind: "immediate" })
    return readLibrary()
  }

  let writes = Promise.resolve()
  return {
    readLibrary, readPage, readScenes, readSceneMessages,
    change(change) {
      const result = writes.then(() => applyChange(change))
      writes = result.then(() => undefined, () => undefined)
      return result
    },
  }
}

export async function openLocalMessageStore() {
  if (typeof SQLite === "undefined") throw new Error("请使用支持 SQLite 的 Scripting 版本")
  const directory = FileManager.appGroupDocumentsDirectory.replace(/\/+$/, "")
  const dbPath = `${directory}/${DATABASE_NAME}`
  const db = SQLite.open(dbPath, { foreignKeysEnabled: true, journalMode: "wal", busyMode: 5 })
  return openMessageStore(db, Storage.get(LIBRARY_STORAGE_KEY, { shared: true }))
}
