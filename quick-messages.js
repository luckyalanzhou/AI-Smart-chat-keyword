import { BUILTIN_CATALOG } from "./message-catalog.js"

export const LIBRARY_STORAGE_KEY = "quick-message-keyboard.library.v1"
export const PAGE_SIZE = 4

function defaults() {
  return {
    version: 1,
    defaultCategoryId: "valorant",
    soundEnabled: true,
    categories: BUILTIN_CATALOG.map((category) => ({ ...category, messages: category.messages.map((message) => ({ ...message })) })),
  }
}
function text(value) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : ""
}

function defaultCategory(categories, id) {
  const visible = categories.filter((category) => category.enabled)
  return visible.find((category) => category.id === id && category.messages.length)
    || visible.find((category) => category.messages.length)
    || visible[0]
}

export function loadLibrary(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.categories)) return defaults()
  const categoryIds = new Set()
  const messageIds = new Set()
  const categories = []
  for (const category of value.categories) {
    if (!category || !text(category.id) || !text(category.title) || categoryIds.has(category.id)) continue
    categoryIds.add(category.id)
    const messages = []
    for (const message of Array.isArray(category.messages) ? category.messages : []) {
      if (!message || !text(message.id) || !text(message.text) || messageIds.has(message.id)) continue
      messageIds.add(message.id)
      const answer = text(message.answer)
      messages.push({ id: message.id, text: text(message.text), ...(answer ? { answer } : {}) })
    }
    categories.push({ id: category.id, title: text(category.title), enabled: category.enabled !== false, messages })
  }
  if (!categories.length) return defaults()
  if (!categories.some((category) => category.enabled)) categories[0].enabled = true
  return {
    version: 1,
    defaultCategoryId: defaultCategory(categories, value.defaultCategoryId).id,
    soundEnabled: value.soundEnabled !== false,
    categories,
  }
}

function freshId(library, prefix) {
  const ids = new Set(library.categories.flatMap((category) => [category.id, ...category.messages.map((message) => message.id)]))
  const stem = `${prefix}-${Date.now().toString(36)}`
  let id = stem
  for (let suffix = 1; ids.has(id); suffix++) id = `${stem}-${suffix}`
  return id
}

function checkedText(value, label, limit) {
  const result = text(value)
  if (!result) throw new Error(`请填写${label}`)
  if ([...result].length > limit) throw new Error(`${label}不能超过 ${limit} 个字`)
  return result
}

// All edits return a new library; the caller persists it only after a successful edit.
export function editLibrary(library, change) {
  const next = loadLibrary(library)
  if (change.type === "preferences") {
    if (typeof change.soundEnabled === "boolean") next.soundEnabled = change.soundEnabled
    if (change.defaultCategoryId !== undefined) {
      const selected = next.categories.find((category) => category.id === change.defaultCategoryId && category.enabled)
      if (!selected || !selected.messages.length) throw new Error("默认分类需要已启用且包含消息")
      next.defaultCategoryId = selected.id
    }
  } else if (change.type === "category.add") {
    const title = checkedText(change.title, "分类名称", 12)
    if (next.categories.some((category) => category.title === title)) throw new Error("已有同名分类")
    next.categories.push({ id: freshId(next, "category"), title, enabled: true, messages: [] })
  } else {
    const categoryId = change.categoryId
    const category = next.categories.find((item) => item.id === categoryId)
    if (!category) throw new Error("分类不存在，请重新选择")
    if (change.type === "category.update") {
      if (change.title !== undefined) {
        const title = checkedText(change.title, "分类名称", 12)
        if (next.categories.some((item) => item.id !== category.id && item.title === title)) throw new Error("已有同名分类")
        category.title = title
      }
      if (typeof change.enabled === "boolean") {
        if (!change.enabled && !next.categories.some((item) => item.id !== category.id && item.enabled)) throw new Error("请至少保留一个启用的分类")
        category.enabled = change.enabled
      }
    } else if (change.type === "category.remove") {
      if (next.categories.length === 1) throw new Error("请至少保留一个分类")
      if (category.enabled && !next.categories.some((item) => item.id !== category.id && item.enabled)) throw new Error("请先启用其他分类")
      next.categories = next.categories.filter((item) => item.id !== category.id)
    } else if (change.type === "message.save") {
      const content = checkedText(change.text, "消息内容", 500)
      const answer = text(change.answer)
      if ([...answer].length > 500) throw new Error("答案不能超过 500 个字")
      if (category.messages.some((item) => item.id !== change.id && item.text === content)) throw new Error("该分类已有相同消息")
      const index = change.id ? category.messages.findIndex((item) => item.id === change.id) : -1
      if (change.id && index < 0) throw new Error("消息已不存在，请重新选择")
      const message = { id: change.id || freshId(next, "message"), text: content, ...(answer ? { answer } : {}) }
      if (index < 0) category.messages.push(message)
      else category.messages[index] = message
    } else if (change.type === "message.remove") {
      if (!category.messages.some((item) => item.id === change.id)) throw new Error("消息已不存在，请重新选择")
      category.messages = category.messages.filter((item) => item.id !== change.id)
    } else {
      throw new Error("不支持的消息库操作")
    }
  }
  next.defaultCategoryId = defaultCategory(next.categories, next.defaultCategoryId).id
  return next
}

export function getMessagePage(library, categoryId, pageIndex = 0) {
  const categories = library.categories.filter((category) => category.enabled)
  const category = categories.find((item) => item.id === categoryId)
    || categories.find((item) => item.id === library.defaultCategoryId)
    || categories[0]
  if (!category) return { categories: [], categoryId: "", title: "暂无分类", messages: [], index: 0, pageCount: 1, total: 0 }
  const pageCount = Math.max(1, Math.ceil(category.messages.length / PAGE_SIZE))
  const index = Math.max(0, Math.min(pageCount - 1, Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0))
  return {
    categories, categoryId: category.id, title: category.title,
    messages: category.messages.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
    index, pageCount, total: category.messages.length,
  }
}
