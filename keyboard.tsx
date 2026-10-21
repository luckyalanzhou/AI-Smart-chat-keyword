import { Button, HStack, ScrollView, Spacer, Text, VStack, modifiers, useState } from "scripting"
import { canReplaceInsertedMessage, drawNextMessage } from "./quick-messages.js"
import { openLocalMessageStore } from "./message-store.js"
import type { DatabasePage, MessageStore } from "./message-store.js"
import type { QuickMessage } from "./quick-messages.js"

type InsertedMessage = { message: QuickMessage; before: string | null; after: string | null; allText: string | null }
type SceneOption = { id: string; title: string; count: number }

let activeQuery = 0
const capsulePalette = ["#005FCC", "#5E35B1", "#AD1457", "#00695C", "#C2410C", "#37474F", "#3949AB"]
for (let index = capsulePalette.length - 1; index > 0; index--) {
  const swap = Math.floor(Math.random() * (index + 1))
  ;[capsulePalette[index], capsulePalette[swap]] = [capsulePalette[swap], capsulePalette[index]]
}
const capsuleColors = new Map<string, string>()

function colorForCapsule(id: string) {
  if (!capsuleColors.has(id)) capsuleColors.set(id, capsulePalette[capsuleColors.size % capsulePalette.length])
  return capsuleColors.get(id)!
}

function inputContext() {
  try {
    return {
      before: CustomKeyboard.textBeforeCursor,
      after: CustomKeyboard.textAfterCursor,
      selected: CustomKeyboard.selectedText,
      allText: CustomKeyboard.allText,
    }
  } catch {
    return null
  }
}

function graphemes(value: string) {
  const Segmenter = (Intl as any)?.Segmenter
  if (typeof Segmenter !== "function") return null
  return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part: { segment: string }) => part.segment)
}

function QuickMessageKeyboard({ store, initialPage, initialScenes }: { store: MessageStore; initialPage: DatabasePage; initialScenes: SceneOption[] }) {
  const [categoryId, setCategoryId] = useState(initialPage.categoryId)
  const [scenes, setScenes] = useState<SceneOption[]>(initialScenes)
  const [activeSceneId, setActiveSceneId] = useState("all")
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState("点分类或场景，随机填入一句")
  const [lastInserted, setLastInserted] = useState<InsertedMessage | null>(null)
  const [previousMessage, setPreviousMessage] = useState<QuickMessage | null>(null)
  const [currentMessage, setCurrentMessage] = useState<QuickMessage | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [drawBags, setDrawBags] = useState<Record<string, { remaining: string[]; lastId: string }>>({})
  function fillAtCursor(item: QuickMessage, successNotice = "已填入 · 发送前可修改") {
    try {
      CustomKeyboard.insertText(item.text)
      setPreviousMessage(null)
      const insertedContext = inputContext()
      setLastInserted({
        message: item,
        before: insertedContext?.before ?? null,
        after: insertedContext?.after ?? null,
        allText: insertedContext?.allText ?? null,
      })
      setCurrentMessage(item)
      setShowAnswer(false)
      setNotice(successNotice)
      if (initialPage.soundEnabled) {
        try { CustomKeyboard.playInputClick() } catch { /* Optional keyboard click sound. */ }
      }
    } catch {
      setNotice("填入失败；请确认输入框仍处于编辑状态")
    }
  }

  function applyMessage(item: QuickMessage) {
    if (!lastInserted) {
      fillAtCursor(item)
      return
    }
    const context = inputContext()
    const units = graphemes(lastInserted.message.text)
    if (!canReplaceInsertedMessage({ ...lastInserted, text: lastInserted.message.text }, context) || !units) {
      fillAtCursor(item, "已填入 · 原内容保留")
      return
    }
    try {
      for (let index = 0; index < units.length; index++) CustomKeyboard.deleteBackward()
      CustomKeyboard.insertText(item.text)
      const insertedContext = inputContext()
      setPreviousMessage(lastInserted.message)
      setLastInserted({
        message: item,
        before: insertedContext?.before ?? null,
        after: insertedContext?.after ?? null,
        allText: insertedContext?.allText ?? null,
      })
      setCurrentMessage(item)
      setShowAnswer(false)
      setNotice("已换句 · 发送前可修改")
      if (initialPage.soundEnabled) {
        try { CustomKeyboard.playInputClick() } catch { /* Optional keyboard click sound. */ }
      }
    } catch {
      setNotice("替换未完成；请检查输入框内容")
    }
  }

  async function choose(category: string, sceneId: string) {
    const requestId = ++activeQuery
    setLoading(true)
    setNotice("正在抽取…")
    try {
      const [messages, nextScenes] = await Promise.all([
        store.readSceneMessages(category, sceneId),
        store.readScenes(category),
      ])
      if (requestId !== activeQuery) return
      setCategoryId(category)
      setScenes(nextScenes)
      setActiveSceneId(sceneId)
      setShowAnswer(false)
      const scope = `${category}\u0000${sceneId}`
      const result = drawNextMessage(messages, drawBags[scope])
      setDrawBags((current) => ({ ...current, [scope]: result.state }))
      if (!result.message) {
        setNotice("这个场景还没有消息")
        return
      }
      applyMessage(result.message)
    } catch {
      if (requestId === activeQuery) setNotice("读取失败，请重新点选")
    } finally {
      if (requestId === activeQuery) setLoading(false)
    }
  }

  function showPrevious() {
    if (!previousMessage || loading) return
    applyMessage(previousMessage)
  }

  function fillAnswer() {
    if (!currentMessage?.answer || loading) return
    const answer = { id: `${currentMessage.id}-answer`, text: currentMessage.answer }
    applyMessage(answer)
  }

  return (
    <VStack alignment="leading" spacing={6} padding={{ horizontal: 10, vertical: 6 }} background="secondarySystemBackground" modifiers={modifiers().frame({ maxWidth: "infinity", maxHeight: "infinity" })}>
      <HStack spacing={8}>
        <Text modifiers={modifiers().font(15).bold().foregroundStyle("label")}>快捷消息</Text>
        <Spacer />
        <Text modifiers={modifiers().font(11).foregroundStyle("secondaryLabel")}>{loading ? "抽取中…" : notice}</Text>
        <Button title="完成" buttonStyle="plain" action={() => CustomKeyboard.dismiss()} />
      </HStack>

      <ScrollView axes="horizontal" scrollIndicator="hidden" modifiers={modifiers().frame({ height: 46 })}>
        <HStack spacing={6}>
          {initialPage.categories.map((category) => (
            <Button key={category.id} title={category.title} buttonStyle="borderedProminent" buttonBorderShape="capsule" tint={colorForCapsule(`category:${category.id}`)} disabled={loading} action={() => { void choose(category.id, "all") }} modifiers={modifiers().frame({ minHeight: 44 }).shadow({ color: "rgba(0,0,0,0.22)", radius: 1, x: 0, y: 3 })} />
          ))}
        </HStack>
      </ScrollView>

      {scenes.some((scene) => scene.id !== "all") ? <ScrollView axes="horizontal" scrollIndicator="hidden" modifiers={modifiers().frame({ height: 46 })}>
        <HStack spacing={6}>
          {scenes.map((scene) => (
            <Button key={scene.id} title={`${scene.title} · ${scene.count}`} buttonStyle="borderedProminent" buttonBorderShape="capsule" tint={colorForCapsule(`scene:${categoryId}:${scene.id}`)} disabled={loading} action={() => { void choose(categoryId, scene.id) }} modifiers={modifiers().frame({ minHeight: 44 }).shadow({ color: "rgba(0,0,0,0.22)", radius: 1, x: 0, y: 3 })} />
          ))}
        </HStack>
      </ScrollView> : null}

      {currentMessage?.answer ? <VStack alignment="leading" spacing={4} padding={{ horizontal: 8, vertical: 2 }}>
        <HStack>
          <Button title={showAnswer ? "收起答案" : "查看答案"} buttonStyle="plain" disabled={loading} action={() => setShowAnswer(!showAnswer)} />
          {showAnswer ? <Button title="填入答案" buttonStyle="bordered" disabled={loading} action={fillAnswer} /> : null}
        </HStack>
        {showAnswer ? <Text modifiers={modifiers().font(14).foregroundStyle("label")}>{currentMessage.answer}</Text> : null}
      </VStack> : null}

      <HStack spacing={8}>
        {previousMessage ? <Button title="上一句" buttonStyle="plain" disabled={loading} action={showPrevious} /> : null}
        <Spacer />
        <Text modifiers={modifiers().font(11).foregroundStyle("secondaryLabel")}>不自动发送</Text>
      </HStack>
    </VStack>
  )
}

CustomKeyboard.requestHeight(216)
async function run() {
  let element
  try {
    const store = await openLocalMessageStore()
    const initialPage = await store.readPage()
    const initialScenes = await store.readScenes(initialPage.categoryId)
    element = <QuickMessageKeyboard store={store} initialPage={initialPage} initialScenes={initialScenes} />
  } catch {
    element = <VStack spacing={12} padding>
      <Text>消息库未能打开，请先在 Scripting 中运行脚本后重试。</Text>
      <Button title="完成" action={() => CustomKeyboard.dismiss()} />
    </VStack>
  }
  CustomKeyboard.present(element)
}
void run()
