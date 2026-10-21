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
  const host = { values, screens: [], inserted: [], clicks: 0, heights: [], presentations: 0, before: "", after: null, selected: null, contextLimit: Infinity, failWrite: false, failInsert: false, failDelete: false, failSound: false, confirm: true, prompt: null }
  host.store = store
  host.db = db
  host.modifierCalls = []
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
  const modifier = new Proxy({}, { get: (_target, name) => (...args) => { host.modifierCalls.push([String(name), args]); return modifier } })
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
    require(name) { if (name === "scripting") return scripting; if (name === "./message-store.js") return { openLocalMessageStore: async () => store }; if (name === "./quick-messages.js") return require("./quick-messages.js"); throw new Error(`Unexpected import: ${name}`) },
    h: (type, props, ...children) => ({ type, props: { ...props, children }, children }),
    Storage: {
      get(key, options) { assert.equal(options?.shared, true); return JSON.parse(JSON.stringify(values.get(key) ?? null)) },
      set(key, value, options) { assert.equal(options?.shared, true); if (host.failWrite) return false; values.set(key, JSON.parse(JSON.stringify(value))); return true },
    },
    CustomKeyboard: {
      requestHeight(height) { host.heights.push(height) },
      present(element) { host.presentations++; screen(element) },
      get textBeforeCursor() { return host.before.slice(-host.contextLimit) },
      get textAfterCursor() { return host.after },
      get selectedText() { return host.selected },
      get allText() { return host.before + (host.selected || "") + (host.after || "") },
      insertText(text) {
        if (host.failInsert) throw new Error("No input")
        host.inserted.push(text)
        if (host.selected) {
          host.before += host.selected
          host.after = host.after
          host.selected = ""
        }
        host.before += text
      },
      deleteBackward() {
        if (host.failDelete) throw new Error("No input")
        host.before = Array.from(host.before).slice(0, -1).join("")
      },
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

test("category capsules insert a random phrase and repeat taps replace it with nullable host context", async () => {
  const host = await launch("keyboard.tsx")
  assert.equal(host.presentations, 1)
  assert.deepEqual(host.heights, [216])
  assert.equal(nodes(host.root.render()).some((item) => item.type === "TextField"), false)
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  const first = host.inserted[0]
  assert.ok(category.messages.some((message) => message.text === first))
  assert.equal(host.clicks, 1)
  assert.match(label(host.root.render()), /已填入/)
  button(host.root, category.title).props.action()
  await settle()
  const second = host.inserted[1]
  assert.ok(category.messages.some((message) => message.text === second))
  assert.equal(host.before, second)
  assert.equal(host.inserted.length, 2)
  assert.match(label(host.root.render()), /已换句/)
  button(host.root, "完成").props.action()
  assert.equal(host.keyboardDismissed, true)
})

test("clear removes only the latest keyboard insertion and preserves the user's draft prefix", async () => {
  const host = await launch("keyboard.tsx")
  host.before = "用户先写的内容："
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  const inserted = host.inserted[0]
  button(host.root, "清空").props.action()
  assert.equal(host.before, "用户先写的内容：")
  assert.equal(host.inserted.length, 1)
  assert.match(label(host.root.render()), /已清除刚填入的文本/)
  assert.equal(nodes(host.root.render()).some((item) => item.type === "Button" && label(item) === "清空"), false)
  assert.ok(inserted)
})

test("clear does not delete a phrase after the user changes text at the cursor", async () => {
  const host = await launch("keyboard.tsx")
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  const draft = `${host.before}（保留这段手动编辑）`
  host.before = draft
  button(host.root, "清空").props.action()
  assert.equal(host.before, draft)
  assert.match(label(host.root.render()), /位置已变化，未清除内容/)
})

test("a long phrase is replaced when the host truncates before-cursor context", async () => {
  const library = loadLibrary(null)
  const text = "计划里的那颗闪，最好也能出现在现场。这波配合的距离，比包点之间还远。人没到齐先别开团，复盘倒不用这么着急集合。"
  library.categories[0].messages = [{ id: "long-reply", text }]
  const host = await launch("keyboard.tsx", library)
  host.contextLimit = 40
  host.db.raw.exec("DELETE FROM messages WHERE category_id = 'valorant' AND id <> 'long-reply'")
  const category = library.categories[0]
  button(host.root, category.title).props.action()
  await settle()
  assert.equal(host.before, text)
  button(host.root, category.title).props.action()
  await settle()
  assert.equal(host.inserted.length, 2)
  assert.equal(host.before, text)
  assert.doesNotMatch(label(host.root.render()), /无法确认上次句子的位置/)
})

test("VALORANT scene capsules limit the random draw to the selected scene", async () => {
  const host = await launch("keyboard.tsx")
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  const scene = button(host.root, "残局沟通 · 13")
  scene.props.action()
  await settle()
  const selected = category.messages.filter((message) => message.scene === "残局沟通")
  assert.ok(selected.some((message) => message.text === host.inserted.at(-1)))
  assert.equal(nodes(host.root.render()).some((item) => item.type === "Button" && label(item) === "下一页"), false)
})

test("shuffle bag avoids repeats until all phrases in the chosen scene have been drawn", async () => {
  const host = await launch("keyboard.tsx")
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  button(host.root, "残局沟通 · 13").props.action()
  await settle()
  const seen = new Set([host.inserted.at(-1)])
  for (let index = 1; index < 13; index++) {
    button(host.root, "残局沟通 · 13").props.action()
    await settle()
    seen.add(host.inserted.at(-1))
  }
  assert.equal(seen.size, 13)
})

test("riddle question, answer reveal and answer replacement are separate actions", async () => {
  const host = await launch("keyboard.tsx")
  const riddle = loadLibrary(null).categories.find((item) => item.id === "riddles").messages[0]
  button(host.root, "脑筋急转弯").props.action()
  await settle()
  const firstQuestion = host.inserted.at(-1)
  const message = loadLibrary(null).categories.find((item) => item.id === "riddles").messages.find((item) => item.text === firstQuestion)
  assert.equal(label(host.root.render()).includes(message.answer), false)
  button(host.root, "查看答案").props.action()
  assert.match(label(host.root.render()), new RegExp(message.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  button(host.root, "填入答案").props.action()
  assert.equal(host.before, message.answer)
  assert.deepEqual(host.inserted, [firstQuestion, message.answer])
})

test("saved preferences hide categories, set the default and suppress click audio", async () => {
  let library = editLibrary(loadLibrary(null), { type: "preferences", defaultCategoryId: "jokes", soundEnabled: false })
  library = editLibrary(library, { type: "category.update", categoryId: "valorant", enabled: false })
  const host = await launch("keyboard.tsx", library)
  assert.equal(nodes(host.root.render()).some((item) => item.type === "Button" && label(item) === "无畏契约回怼"), false)
  button(host.root, library.categories.find((item) => item.id === "jokes").title).props.action()
  await settle()
  assert.equal(host.clicks, 0)
})

test("changed input context inserts immediately at the current cursor without deleting prior text", async () => {
  const host = await launch("keyboard.tsx")
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  const original = host.before
  host.before = `${original}（用户修改）`
  button(host.root, category.title).props.action()
  await settle()
  assert.equal(host.inserted.length, 2)
  assert.equal(host.before, `${original}（用户修改）${host.inserted[1]}`)
  assert.match(label(host.root.render()), /已填入 · 原内容保留/)
  assert.equal(nodes(host.root.render()).some((item) => item.type === "Button" && ["填入", "取消"].includes(label(item))), false)
})

test("repeated capsule taps replace the previous phrase after the user edits only its prefix", async () => {
  const host = await launch("keyboard.tsx")
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  const original = host.before
  host.before = `修改过的聊天前缀：${original}`
  button(host.root, category.title).props.action()
  await settle()
  assert.equal(host.inserted.length, 2)
  assert.equal(host.before, `修改过的聊天前缀：${host.inserted[1]}`)
  assert.match(label(host.root.render()), /已换句/)
})

test("selected text is handled by immediate host insertion without a confirmation step", async () => {
  const host = await launch("keyboard.tsx")
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  host.selected = "已选中的用户文字"
  button(host.root, category.title).props.action()
  await settle()
  assert.equal(host.inserted.length, 2)
  assert.match(host.before, /已选中的用户文字/)
  assert.match(host.before, new RegExp(host.inserted[1]))
  assert.match(label(host.root.render()), /已填入 · 原内容保留/)
})

test("a failed delete keeps the previous phrase and reports that replacement did not finish", async () => {
  const host = await launch("keyboard.tsx")
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  const previous = host.before
  host.failDelete = true
  button(host.root, category.title).props.action()
  await settle()
  assert.equal(host.before, previous)
  assert.equal(host.inserted.length, 1)
  assert.match(label(host.root.render()), /替换未完成；请检查输入框内容/)
})

test("capsules use randomized session colors and raised native capsule buttons", async () => {
  const host = await launch("keyboard.tsx")
  const rendered = nodes(host.root.render()).filter((item) => item.type === "Button" && item.props.buttonBorderShape === "capsule")
  assert.ok(rendered.length >= 2)
  assert.ok(rendered.every((item) => item.props.buttonStyle === "borderedProminent" && /^#[0-9A-F]{6}$/i.test(item.props.tint)))
  const firstColors = rendered.map((item) => item.props.tint)
  assert.deepEqual(nodes(host.root.render()).filter((item) => item.type === "Button" && item.props.buttonBorderShape === "capsule").map((item) => item.props.tint), firstColors)
  assert.ok(host.modifierCalls.some(([name, args]) => name === "shadow" && args[0]?.y === 3))
})

test("host insertion failures show feedback instead of claiming success", async () => {
  const host = await launch("keyboard.tsx")
  host.failInsert = true
  button(host.root, loadLibrary(null).categories.find((item) => item.id === "valorant").title).props.action()
  await settle()
  assert.deepEqual(host.inserted, [])
  assert.match(label(host.root.render()), /填入失败/)
})

test("an unavailable click sound does not turn a successful insertion into an error", async () => {
  const host = await launch("keyboard.tsx")
  host.failSound = true
  const category = loadLibrary(null).categories.find((item) => item.id === "valorant")
  button(host.root, category.title).props.action()
  await settle()
  assert.equal(host.inserted.length, 1)
  assert.match(label(host.root.render()), /已填入/)
})

test("settings can add a scene-tagged multiline snippet and persist it for keyboard filtering", async () => {
  const host = await launch("index.tsx")
  button(host.root, "添加消息").props.action()
  const editor = host.screens.at(-1)
  field(editor, "场景").props.onChanged("开黑沟通")
  field(editor, "消息内容").props.onChanged("第一行\n第二行")
  field(editor, "答案（可选）").props.onChanged("独立答案")
  button(editor, "保存").props.action()
  await settle()
  assert.equal(editor.dismissed, 1)
  const saved = await host.store.readLibrary()
  assert.equal(saved.categories[0].messages.at(-1).text, "第一行\n第二行")
  assert.equal(saved.categories[0].messages.at(-1).scene, "开黑沟通")
  const scenes = await host.store.readScenes("valorant")
  assert.ok(scenes.some((scene) => scene.id === "开黑沟通" && scene.count === 1))
  assert.equal((await host.store.readSceneMessages("valorant", "开黑沟通"))[0].text, "第一行\n第二行")
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
