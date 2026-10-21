const assert = require("node:assert/strict")
const { test } = require("node:test")
const { loadLibrary, editLibrary, getMessagePage, PAGE_SIZE } = require("./quick-messages.js")

test("the offline catalog includes game comebacks, jokes and separate riddle answers", () => {
  const library = loadLibrary(null)
  assert.equal(library.categories.length, 7)
  assert.equal(library.defaultCategoryId, "valorant")
  assert.equal(library.categories[0].messages.length, 120)
  assert.equal(library.categories.reduce((count, category) => count + category.messages.length, 0), 510)
  const riddles = library.categories.find((category) => category.id === "riddles")
  assert.ok(riddles.messages.every((message) => message.answer && !message.text.includes(message.answer)))
  const ids = library.categories.flatMap((category) => [category.id, ...category.messages.map((message) => message.id)])
  assert.equal(new Set(ids).size, ids.length)
})

test("category and message edits are immutable and survive shared-storage serialization", () => {
  const original = loadLibrary(null)
  const snapshot = JSON.stringify(original)
  let next = editLibrary(original, { type: "category.add", title: "  我的常用  " })
  const categoryId = next.categories.at(-1).id
  next = editLibrary(next, { type: "message.save", categoryId, text: " 第一行\r\n第二行 ", answer: " 答案 " })
  const message = next.categories.at(-1).messages[0]
  assert.equal(message.text, "第一行\n第二行")
  assert.equal(message.answer, "答案")
  next = editLibrary(next, { type: "preferences", defaultCategoryId: categoryId, soundEnabled: false })
  assert.deepEqual(loadLibrary(JSON.parse(JSON.stringify(next))), next)
  assert.equal(JSON.stringify(original), snapshot)
  assert.equal(loadLibrary(null).categories.length, original.categories.length)
})

test("editing a message retains its id and can remove its answer", () => {
  const library = loadLibrary(null)
  const first = library.categories.find((category) => category.id === "riddles").messages[0]
  const next = editLibrary(library, { type: "message.save", categoryId: "riddles", id: first.id, text: "新的题目", answer: "" })
  const changed = next.categories.find((category) => category.id === "riddles").messages[0]
  assert.deepEqual(changed, { id: first.id, text: "新的题目" })
  assert.equal(next.categories.find((category) => category.id === "riddles").messages.length, 60)
  assert.notEqual(library.categories.find((category) => category.id === "riddles").messages[0].text, changed.text)
})

test("removing a message or category leaves the other content intact", () => {
  const library = loadLibrary(null)
  const first = library.categories[0].messages[0]
  const next = editLibrary(library, { type: "message.remove", categoryId: "valorant", id: first.id })
  assert.deepEqual(next.categories[0].messages, library.categories[0].messages.slice(1))
  assert.deepEqual(next.categories.slice(1), library.categories.slice(1))
  const removed = editLibrary(next, { type: "category.remove", categoryId: "valorant" })
  assert.equal(removed.categories.some((category) => category.id === "valorant"), false)
  assert.notEqual(removed.defaultCategoryId, "valorant")
})

test("hiding or emptying the default category selects a usable fallback", () => {
  const library = loadLibrary(null)
  const hidden = editLibrary(library, { type: "category.update", categoryId: "valorant", enabled: false })
  assert.equal(hidden.defaultCategoryId, "comebacks")
  assert.equal(getMessagePage(hidden, "valorant").categoryId, "comebacks")
  assert.equal(getMessagePage(hidden).categories.some((category) => category.id === "valorant"), false)
  let empty = library
  for (const message of library.categories[0].messages) empty = editLibrary(empty, { type: "message.remove", categoryId: "valorant", id: message.id })
  assert.equal(empty.defaultCategoryId, "comebacks")
  assert.equal(getMessagePage(empty, "valorant").total, 0)
})

test("the last visible category and the last category cannot be removed", () => {
  let library = loadLibrary(null)
  for (const category of library.categories.slice(1)) library = editLibrary(library, { type: "category.update", categoryId: category.id, enabled: false })
  assert.throws(() => editLibrary(library, { type: "category.update", categoryId: "valorant", enabled: false }), /至少保留/)
  assert.throws(() => editLibrary(library, { type: "category.remove", categoryId: "valorant" }), /启用其他/)
  for (const category of library.categories.slice(1)) library = editLibrary(library, { type: "category.remove", categoryId: category.id })
  assert.throws(() => editLibrary(library, { type: "category.remove", categoryId: "valorant" }), /至少保留/)
})

test("invalid edits fail without changing saved data", () => {
  const library = loadLibrary(null)
  const snapshot = JSON.stringify(library)
  const cases = [
    [{ type: "category.add", title: " " }, /填写/],
    [{ type: "category.add", title: "笑话" }, /同名/],
    [{ type: "category.add", title: "字".repeat(13) }, /12/],
    [{ type: "category.update", categoryId: "jokes", title: "无畏契约回怼" }, /同名/],
    [{ type: "message.save", categoryId: "jokes", text: "" }, /填写/],
    [{ type: "message.save", categoryId: "jokes", text: "字".repeat(501) }, /500/],
    [{ type: "message.save", categoryId: "jokes", text: "测试", answer: "字".repeat(501) }, /500/],
    [{ type: "message.save", categoryId: "jokes", text: library.categories.find((category) => category.id === "jokes").messages[0].text }, /相同/],
    [{ type: "message.save", categoryId: "jokes", id: "missing", text: "消息" }, /不存在/],
    [{ type: "message.remove", categoryId: "jokes", id: "missing" }, /不存在/],
    [{ type: "category.remove", categoryId: "missing" }, /不存在/],
    [{ type: "preferences", defaultCategoryId: "missing" }, /默认分类/],
  ]
  for (const [change, expected] of cases) assert.throws(() => editLibrary(library, change), expected)
  assert.equal(JSON.stringify(library), snapshot)
})

test("pagination reaches every message exactly once and clamps out-of-range pages", () => {
  const library = loadLibrary(null)
  for (const category of library.categories) {
    const first = getMessagePage(library, category.id)
    const pages = Array.from({ length: first.pageCount }, (_, index) => getMessagePage(library, category.id, index))
    assert.ok(pages.every((page) => page.messages.length <= PAGE_SIZE))
    assert.deepEqual(pages.flatMap((page) => page.messages), category.messages)
    assert.equal(getMessagePage(library, category.id, 999).index, first.pageCount - 1)
    assert.equal(getMessagePage(library, category.id, -10).index, 0)
    assert.equal(getMessagePage(library, category.id, Infinity).index, 0)
  }
  assert.equal(getMessagePage(library, "missing").categoryId, library.defaultCategoryId)
})

test("empty custom categories have an empty page and cannot become the default", () => {
  const library = editLibrary(loadLibrary(null), { type: "category.add", title: "自定义" })
  const categoryId = library.categories.at(-1).id
  assert.equal(getMessagePage(library, categoryId).pageCount, 1)
  assert.deepEqual(getMessagePage(library, categoryId).messages, [])
  assert.throws(() => editLibrary(library, { type: "preferences", defaultCategoryId: categoryId }), /默认分类/)
})

test("malformed stored records are handled without reintroducing deleted defaults", () => {
  const library = loadLibrary({ version: 1, soundEnabled: false, defaultCategoryId: "bad", categories: [
    null,
    { id: "custom", title: " 我的分类 ", enabled: false, messages: [null, { id: "one", text: " 保留下来 " }, { id: "one", text: "重复 id" }, { id: "blank", text: " " }] },
    { id: "custom", title: "重复分类", messages: [] },
  ] })
  assert.equal(library.categories.length, 1)
  assert.equal(library.categories[0].enabled, true)
  assert.deepEqual(library.categories[0].messages, [{ id: "one", text: "保留下来" }])
  assert.equal(library.defaultCategoryId, "custom")
  assert.equal(library.soundEnabled, false)
  assert.equal(loadLibrary({ version: 1, categories: [] }).categories.length, 7)
})
