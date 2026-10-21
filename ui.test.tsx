const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")
const { test, afterEach } = require("node:test")
const { loadLibrary, editLibrary, LIBRARY_STORAGE_KEY } = require("./quick-messages.js")
const { openMessageStore } = require("./message-store.js")
const createDatabase = require("./test-sqlite.js")

const databases = new Set()
afterEach(() => { for (const db of databases) db.close(); databases.clear() })
const settle = () => new Promise((resolve) => setImmediate(resolve))

// Execute the real TSX handlers with mocked host controls, not source regexes.
async function launch(file, initial = loadLibrary(null), db = createDatabase()) {
  databases.add(db)
  const store = await openMessageStore(db, initial)
  const values = new Map([[LIBRARY_STORAGE_KEY, JSON.parse(JSON.stringify(initial))], ["unrelated.setting", { value: "keep" }]])
  const host = { values, screens: [], inserted: [], clicks: 0, heights: [], presentations: 0, failWrite: false, failInsert: false, failSound: false, confirm: true, prompt: null }
  host.store = store
  host.db = db
  Object.defineProperty(host, "failWrite", { get: () => db.failWrite, set: (value) => { db.failWrite = value } })
  let activeScreen
  function screen(element, resolve) {
    const instance = { element, state: [], dismissed: 0, resolve, render() {
      const previous = activeScreen
      activeScreen = instance
      instance.cursor = 0
      try { return typeof element.type === "function" ? element.type(element.props) : element } finally { activeScreen = previous }
    } }
    host.screens.push(instance)
    return instance
  }
  const controls = Object.fromEntries(["Button", "Form", "HStack", "NavigationStack", "Picker", "ScrollView", "Section", "Spacer", "Text", "TextField", "Toggle", "VStack"].map((name) => [name, name]))
  const modifier = new Proxy({}, { get: () => () => modifier })
  const scripting = { ...controls,
    modifiers: () => modifier,
    useState(initialValue) {
      const instance = activeScreen
      const index = instance.cursor++
      if (!(index in instance.state)) instance.state[index] = initialValue
      return [instance.state[index], (next) => { instance.state[index] = typeof next === "function" ? next(instance.state[index]) : next }]
    },
    Navigation: {
      useDismiss() { const instance = activeScreen; return () => { instance.dismissed++; instance.resolve?.() } },
      present({ element }) { return new Promise((resolve) => screen(element, resolve)) },
    },
    Script: { enableMinimize() {}, exit() {} },
  }
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: "h" },
  })
  assert.equal(compiled.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0)
  const sandbox = {
    exports: {},
    require(name) { if (name === "scripting") return scripting; if (name === "./message-store.js") return { openLocalMessageStore: async () => store }; throw new Error(`Unexpected import: ${name}`) },
    h: (type, props, ...children) => ({ type, props: { ...props, children }, children }),
    Storage: {
      get(key, options) { assert.equal(options?.shared, true); return JSON.parse(JSON.stringify(values.get(key) ?? null)) },
      set(key, value, options) { assert.equal(options?.shared, true); if (host.failWrite) return false; values.set(key, JSON.parse(JSON.stringify(value))); return true },
    },
    CustomKeyboard: {
      requestHeight(height) { host.heights.push(height) },
      present(element) { host.presentations++; screen(element) },
      insertText(text) { if (host.failInsert) throw new Error("No input"); host.inserted.push(text) },
      playInputClick() { if (host.failSound) throw new Error("No audio"); host.clicks++ },
      dismiss() { host.keyboardDismissed = true },
    },
    Dialog: { prompt: async () => host.prompt, confirm: async () => host.confirm, alert: async (options) => { host.alert = options } },
    fetch() { throw new Error("Offline keyboard must not request the network") },
  }
  vm.runInNewContext(compiled.outputText, sandbox, { filename: file })
  await settle()
  assert.ok(host.screens[0], host.alert?.message || "The screen did not open")
  host.root = host.screens[0]
  return host
}

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes)
  if (!element || typeof element !== "object" || !element.type) return []
  return [element, ...nodes(element.props.header), ...nodes(element.children), ...nodes(element.props.footer), ...Object.values(element.props.toolbar || {}).flatMap(nodes)]
}

function label(element) {
  if (Array.isArray(element)) return element.map(label).join("")
  if (element == null || typeof element === "boolean") return ""
  if (typeof element !== "object") return String(element)
  return element.props.title || `${label(element.props.header)}${label(element.children)}${label(element.props.footer)}`
}

function button(screen, title) {
  const found = nodes(screen.render()).find((item) => item.type === "Button" && label(item) === title)
  assert.ok(found, `Missing button: ${title}`)
  return found
}

function field(screen, title) {
  const found = nodes(screen.render()).find((item) => item.type === "TextField" && item.props.title === title)
  assert.ok(found, `Missing field: ${title}`)
  return found
}

test("keyboard presents once, inserts selected text verbatim and leaves sending to the host", async () => {
  const host = await launch("keyboard.tsx")
  assert.equal(host.presentations, 1)
  assert.deepEqual(host.heights, [320])
  assert.equal(nodes(host.root.render()).some((item) => item.type === "TextField"), false)
  const first = loadLibrary(null).categories[0].messages[0]
  button(host.root, first.text).props.action()
  assert.deepEqual(host.inserted, [first.text])
  assert.equal(host.clicks, 1)
  assert.match(label(host.root.render()), /已填入/)
  button(host.root, "完成").props.action()
  assert.equal(host.keyboardDismissed, true)
})

test("category switching and pagination reset selection without inserting any text", async () => {
  const host = await launch("keyboard.tsx")
  assert.equal(button(host.root, "上一页").props.disabled, true)
  button(host.root, "下一页").props.action()
  await settle()
  button(host.root, loadLibrary(null).categories[0].messages[4].text)
  button(host.root, "笑话").props.action()
  await settle()
  button(host.root, loadLibrary(null).categories.find((item) => item.id === "jokes").messages[0].text)
  assert.equal(button(host.root, "上一页").props.disabled, true)
  assert.deepEqual(host.inserted, [])
})

test("a slower category query cannot overwrite a newer keyboard selection", async () => {
  const host = await launch("keyboard.tsx")
  const readPage = host.store.readPage
  const pending = []
  host.store.readPage = (id, index) => new Promise((resolve) => pending.push(async () => resolve(await readPage(id, index))))
  button(host.root, "笑话").props.action()
  assert.equal(button(host.root, loadLibrary(null).categories[0].messages[0].text).props.disabled, true)
  button(host.root, "脑筋急转弯").props.action()
  await pending[1]()
  await settle()
  const riddle = loadLibrary(null).categories.find((category) => category.id === "riddles").messages[0]
  button(host.root, riddle.text)
  await pending[0]()
  await settle()
  button(host.root, riddle.text)
  assert.deepEqual(host.inserted, [])
})

test("the keyboard can pick another page without inserting a message", async () => {
  const host = await launch("keyboard.tsx")
  button(host.root, "换一组").props.action()
  await settle()
  assert.equal(button(host.root, "上一页").props.disabled, false)
  assert.deepEqual(host.inserted, [])
})

test("riddle question, answer reveal and answer insertion are separate actions", async () => {
  const host = await launch("keyboard.tsx")
  const riddle = loadLibrary(null).categories.find((item) => item.id === "riddles").messages[0]
  button(host.root, "脑筋急转弯").props.action()
  await settle()
  assert.equal(label(host.root.render()).includes(riddle.answer), false)
  button(host.root, riddle.text).props.action()
  assert.deepEqual(host.inserted, [riddle.text])
  button(host.root, "答案").props.action()
  assert.deepEqual(host.inserted, [riddle.text])
  button(host.root, `填入答案：${riddle.answer}`).props.action()
  assert.deepEqual(host.inserted, [riddle.text, riddle.answer])
  button(host.root, "下一页").props.action()
  await settle()
  assert.equal(label(host.root.render()).includes(riddle.answer), false)
})

test("saved preferences hide categories, set the default and suppress click audio", async () => {
  let library = editLibrary(loadLibrary(null), { type: "preferences", defaultCategoryId: "jokes", soundEnabled: false })
  library = editLibrary(library, { type: "category.update", categoryId: "valorant", enabled: false })
  const host = await launch("keyboard.tsx", library)
  assert.equal(nodes(host.root.render()).some((item) => item.type === "Button" && label(item) === "无畏契约回怼"), false)
  button(host.root, library.categories.find((item) => item.id === "jokes").messages[0].text).props.action()
  assert.equal(host.clicks, 0)
})

test("host insertion failures show feedback instead of claiming success", async () => {
  const host = await launch("keyboard.tsx")
  host.failInsert = true
  button(host.root, loadLibrary(null).categories[0].messages[0].text).props.action()
  assert.deepEqual(host.inserted, [])
  assert.match(label(host.root.render()), /请先点选输入框/)
})

test("an unavailable click sound does not turn a successful insertion into an error", async () => {
  const host = await launch("keyboard.tsx")
  host.failSound = true
  const text = loadLibrary(null).categories[0].messages[0].text
  button(host.root, text).props.action()
  assert.deepEqual(host.inserted, [text])
  assert.match(label(host.root.render()), /已填入/)
})

test("settings can add a multiline snippet and the reopened keyboard uses it", async () => {
  const host = await launch("index.tsx")
  button(host.root, "添加消息").props.action()
  const editor = host.screens.at(-1)
  field(editor, "消息内容").props.onChanged("第一行\n第二行")
  field(editor, "答案（可选）").props.onChanged("独立答案")
  button(editor, "保存").props.action()
  await settle()
  assert.equal(editor.dismissed, 1)
  const saved = await host.store.readLibrary()
  assert.equal(saved.categories[0].messages.at(-1).text, "第一行\n第二行")
  const keyboard = await launch("keyboard.tsx", undefined, host.db)
  while (!button(keyboard.root, "下一页").props.disabled) {
    button(keyboard.root, "下一页").props.action()
    await settle()
  }
  button(keyboard.root, "第一行\n第二行").props.action()
  assert.deepEqual(keyboard.inserted, ["第一行\n第二行"])
  assert.deepEqual(host.values.get("unrelated.setting"), { value: "keep" })
})

test("failed saves keep the editor open and leave stored messages untouched", async () => {
  const host = await launch("index.tsx")
  const before = JSON.stringify(await host.store.readLibrary())
  button(host.root, "添加消息").props.action()
  const editor = host.screens.at(-1)
  field(editor, "消息内容").props.onChanged("不能丢掉的草稿")
  host.failWrite = true
  button(editor, "保存").props.action()
  await settle()
  assert.equal(editor.dismissed, 0)
  assert.match(label(editor.render()), /保存失败/)
  assert.equal(field(editor, "消息内容").props.value, "不能丢掉的草稿")
  assert.equal(JSON.stringify(await host.store.readLibrary()), before)
})

test("settings paginate the large category and search text beyond the first page", async () => {
  const host = await launch("index.tsx")
  const messages = loadLibrary(null).categories[0].messages
  const firstPageButtons = nodes(host.root.render()).filter((item) => item.type === "Button" && messages.some((message) => message.text === label(item)))
  assert.equal(firstPageButtons.length, 20)
  assert.equal(nodes(host.root.render()).some((item) => item.type === "Button" && label(item) === messages.at(-1).text), false)
  field(host.root, "搜索当前分类").props.onChanged(messages.at(-1).text)
  button(host.root, messages.at(-1).text)
  assert.equal(nodes(host.root.render()).filter((item) => item.type === "Button" && messages.some((message) => message.text === label(item))).length, 1)
})

test("category creation and cancelled deletion respect user choices", async () => {
  const host = await launch("index.tsx")
  host.prompt = "我的开黑"
  await button(host.root, "新增分类").props.action()
  // Handlers intentionally return void; allow the native prompt continuation to finish.
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await host.store.readLibrary()).categories.at(-1).title, "我的开黑")
  host.confirm = false
  await button(host.root, "删除当前分类").props.action()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await host.store.readLibrary()).categories.at(-1).title, "我的开黑")
  host.confirm = true
  await button(host.root, "删除当前分类").props.action()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await host.store.readLibrary()).categories.some((item) => item.title === "我的开黑"), false)
})
