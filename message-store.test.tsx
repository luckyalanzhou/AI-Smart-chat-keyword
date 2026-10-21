const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { BUILTIN_CATALOG, CATALOG_VERSION } = require("./message-catalog.js")
const { openMessageStore } = require("./message-store.js")
const createDatabase = require("./test-sqlite.js")

test("SQLite initializes 510 unique local messages and supports indexed page queries", async (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const store = await openMessageStore(db)
  const library = await store.readLibrary()
  assert.equal(library.categories.reduce((count, category) => count + category.messages.length, 0), 510)
  assert.equal(new Set(library.categories.flatMap((category) => category.messages.map((message) => message.text))).size, 510)
  db.queries.length = 0
  const page = await store.readPage("valorant", 29)
  assert.equal(page.total, 120)
  assert.equal(page.pageCount, 30)
  assert.equal(page.messages.length, 4)
  assert.deepEqual(page.messages, BUILTIN_CATALOG[0].messages.slice(-4))
  assert.ok(db.queries.some((query) => query.includes("LIMIT ? OFFSET ?")))
  const plan = db.raw.prepare("EXPLAIN QUERY PLAN SELECT id, text FROM messages WHERE category_id = ? AND deleted = 0 ORDER BY position, id LIMIT 4").all("valorant")
  assert.ok(plan.some((row) => row.detail.includes("message_page")))
})

test("edits persist in an actual database file after closing and reopening", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quick-message-test-"))
  const file = path.join(directory, "messages.sqlite")
  let db = createDatabase(file)
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  let store = await openMessageStore(db)
  await store.change({ type: "message.save", categoryId: "valorant", id: "valorant-1", text: "修改过的消息", answer: "独立答案" })
  await store.change({ type: "preferences", soundEnabled: false })
  db.close()
  db = createDatabase(file)
  store = await openMessageStore(db)
  const page = await store.readPage("valorant")
  assert.equal(page.messages[0].text, "修改过的消息")
  assert.equal(page.messages[0].answer, "独立答案")
  assert.equal(page.soundEnabled, false)
})

test("seed updates append new content without restoring deletions or replacing edits", async (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  let store = await openMessageStore(db)
  await store.change({ type: "message.remove", categoryId: "valorant", id: "valorant-1" })
  await store.change({ type: "message.save", categoryId: "valorant", id: "valorant-2", text: "我的改写" })
  await store.change({ type: "category.remove", categoryId: "jokes" })
  const catalog = structuredClone(BUILTIN_CATALOG)
  catalog[0].messages.push({ id: "valorant-new", text: "新版新增条目" })
  store = await openMessageStore(db, null, catalog, CATALOG_VERSION + 1)
  const library = await store.readLibrary()
  assert.equal(library.categories.some((category) => category.id === "jokes"), false)
  assert.equal(library.categories[0].messages.some((message) => message.id === "valorant-1"), false)
  assert.equal(library.categories[0].messages.find((message) => message.id === "valorant-2").text, "我的改写")
  assert.equal(library.categories[0].messages.at(-1).text, "新版新增条目")
})

test("legacy shared-storage migration preserves custom content and deleted original entries", async (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const legacy = {
    version: 1, defaultCategoryId: "valorant", soundEnabled: false,
    categories: [{ id: "valorant", title: "开黑", enabled: true, messages: [
      { id: "valorant-2", text: "旧版编辑后的内容" },
      { id: "custom-one", text: "自己添加的消息", answer: "自己的答案" },
    ] }],
  }
  const snapshot = JSON.stringify(legacy)
  const store = await openMessageStore(db, legacy)
  const library = await store.readLibrary()
  assert.equal(library.categories.length, 1)
  assert.equal(library.categories[0].title, "开黑")
  assert.equal(library.categories[0].messages.some((message) => message.id === "valorant-1"), false)
  assert.equal(library.categories[0].messages.find((message) => message.id === "valorant-2").text, "旧版编辑后的内容")
  assert.equal(library.categories[0].messages.some((message) => message.id === "custom-one"), true)
  assert.equal(library.categories[0].messages.length, 98)
  assert.equal(library.soundEnabled, false)
  assert.equal(JSON.stringify(legacy), snapshot)
})

test("interrupted initialization rolls back, then can be retried without duplicates", async (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  db.failAtStep = 20
  await assert.rejects(openMessageStore(db), /interrupted/)
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 0)
  db.failAtStep = -1
  const store = await openMessageStore(db)
  await openMessageStore(db)
  assert.equal((await store.readPage("valorant")).total, 120)
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 510)
})

test("failed writes do not remove existing content and subsequent writes still work", async (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const store = await openMessageStore(db)
  const before = await store.readLibrary()
  db.failWrite = true
  await assert.rejects(store.change({ type: "message.remove", categoryId: "valorant", id: "valorant-1" }))
  db.failWrite = false
  assert.deepEqual(await store.readLibrary(), before)
  await store.change({ type: "message.save", categoryId: "valorant", text: "失败后依然能保存" })
  assert.equal((await store.readPage("valorant")).total, 121)
})

test("concurrent edits are serialized and appending after deletions preserves order", async (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const store = await openMessageStore(db)
  await store.change({ type: "category.remove", categoryId: "comebacks" })
  await Promise.all([
    store.change({ type: "category.add", title: "第一类" }),
    store.change({ type: "category.add", title: "第二类" }),
  ])
  let library = await store.readLibrary()
  assert.deepEqual(library.categories.slice(-2).map((category) => category.title), ["第一类", "第二类"])
  await store.change({ type: "message.remove", categoryId: "valorant", id: "valorant-1" })
  await Promise.all([
    store.change({ type: "message.save", categoryId: "valorant", text: "追加甲" }),
    store.change({ type: "message.save", categoryId: "valorant", text: "追加乙" }),
  ])
  library = await store.readLibrary()
  assert.deepEqual(library.categories[0].messages.slice(-2).map((message) => message.text), ["追加甲", "追加乙"])
})

test("text containing quotes and SQL-looking content is stored literally", async (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const store = await openMessageStore(db)
  const content = "消息'); DROP TABLE messages; --\n下一行"
  await store.change({ type: "message.save", categoryId: "valorant", text: content })
  const library = await store.readLibrary()
  assert.equal(library.categories[0].messages.at(-1).text, content)
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 511)
})
