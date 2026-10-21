import { Button, HStack, ScrollView, Spacer, Text, VStack, modifiers, useState } from "scripting"
import { canReplaceInsertedMessage, drawNextMessage } from "./quick-messages.js"
import { openLocalMessageStore } from "./message-store.js"
import type { DatabasePage, MessageStore } from "./message-store.js"
import type { QuickMessage } from "./quick-messages.js"

type InsertedMessage = { message: QuickMessage; after: string | null }
type MessageCandidate = { message: QuickMessage; categoryId: string; warning?: string }
type SceneOption = { id: string; title: string; count: number }

let activeQuery = 0

function inputContext() {
  try {
    return {
      before: CustomKeyboard.textBeforeCursor,
      after: CustomKeyboard.textAfterCursor,
      selected: CustomKeyboard.selectedText,
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
  const [candidate, setCandidate] = useState<MessageCandidate | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [drawBags, setDrawBags] = useState<Record<string, { remaining: string[]; lastId: string }>>({})
  const currentCategory = initialPage.categories.find((item) => item.id === categoryId) || initialPage.categories[0]

  function fillAtCursor(item: MessageCandidate) {
    const context = inputContext()
    try {
      CustomKeyboard.insertText(item.message.text)
      setPreviousMessage(null)
      setLastInserted({ message: item.message, after: context?.after ?? null })
      setCurrentMessage(item.message)
      setShowAnswer(false)
      setCandidate(null)
      setNotice("已填入 · 发送前可修改")
      if (initialPage.soundEnabled) {
        try { CustomKeyboard.playInputClick() } catch { /* Optional keyboard click sound. */ }
      }
    } catch {
      setCandidate(item)
      setNotice("填入失败；请确认输入框仍处于编辑状态")
    }
  }

  function applyMessage(item: MessageCandidate) {
    if (!lastInserted) {
      fillAtCursor(item)
      return
    }
    const context = inputContext()
    const units = graphemes(lastInserted.message.text)
    if (!canReplaceInsertedMessage({ text: lastInserted.message.text, after: lastInserted.after }, context) || !units) {
      setCandidate({ ...item, warning: "无法确认上次句子的位置，因此不会自动替换。填入会按当前光标或选区执行。" })
      setNotice("输入位置已变化；确认后会在光标处填入")
      return
    }
    try {
      for (let index = 0; index < units.length; index++) CustomKeyboard.deleteBackward()
      CustomKeyboard.insertText(item.message.text)
      setPreviousMessage(lastInserted.message)
      setLastInserted({ message: item.message, after: lastInserted.after })
      setCurrentMessage(item.message)
      setShowAnswer(false)
      setCandidate(null)
      setNotice("已换句 · 发送前可修改")
      if (initialPage.soundEnabled) {
        try { CustomKeyboard.playInputClick() } catch { /* Optional keyboard click sound. */ }
      }
    } catch {
      setCandidate({ ...item, warning: "替换操作未完成，请先检查输入框；填入会按当前光标或选区执行。" })
      setNotice("替换未完成；请检查输入框后再填入")
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
        setCandidate(null)
        setNotice("这个场景还没有消息")
        return
      }
      applyMessage({ message: result.message, categoryId: category })
    } catch {
      if (requestId === activeQuery) setNotice("读取失败，请重新点选")
    } finally {
      if (requestId === activeQuery) setLoading(false)
    }
  }

  function fillCandidate() {
    if (!candidate || loading) return
    fillAtCursor(candidate)
  }

  function showPrevious() {
    if (!previousMessage || loading) return
    applyMessage({ message: previousMessage, categoryId })
  }

  function fillAnswer() {
    if (!currentMessage?.answer || loading) return
    const answer = { id: `${currentMessage.id}-answer`, text: currentMessage.answer }
    applyMessage({ message: answer, categoryId })
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
            <Button key={category.id} title={category.title} buttonStyle={category.id === categoryId ? "borderedProminent" : "bordered"} buttonBorderShape="capsule" disabled={loading} action={() => { void choose(category.id, "all") }} modifiers={modifiers().frame({ minHeight: 44 })} />
          ))}
        </HStack>
      </ScrollView>

      {scenes.some((scene) => scene.id !== "all") ? <ScrollView axes="horizontal" scrollIndicator="hidden" modifiers={modifiers().frame({ height: 46 })}>
        <HStack spacing={6}>
          {scenes.map((scene) => (
            <Button key={scene.id} title={`${scene.title} · ${scene.count}`} buttonStyle={activeSceneId === scene.id ? "borderedProminent" : "bordered"} buttonBorderShape="capsule" disabled={loading} action={() => { void choose(categoryId, scene.id) }} modifiers={modifiers().frame({ minHeight: 44 })} />
          ))}
        </HStack>
      </ScrollView> : null}

      <VStack alignment="leading" spacing={4} padding={{ horizontal: 8, vertical: 5 }} modifiers={modifiers().frame({ maxWidth: "infinity", maxHeight: "infinity" })}>
        {candidate ? <VStack alignment="leading" spacing={4}>
          <Text modifiers={modifiers().font(15).foregroundStyle("label")}>{candidate.message.text}</Text>
          <Text modifiers={modifiers().font(11).foregroundStyle("secondaryLabel")}>{candidate.warning || "无法确认上一句的位置；填入会按当前光标或选区执行。"}</Text>
          <HStack>
            <Button title="填入" buttonStyle="borderedProminent" disabled={loading} action={fillCandidate} />
            <Button title="取消" buttonStyle="plain" disabled={loading} action={() => { setCandidate(null); setNotice("候选已取消") }} />
          </HStack>
        </VStack> : currentMessage ? <VStack alignment="leading" spacing={4}>
          <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>{currentCategory?.title || "快捷消息"}{currentMessage.scene ? ` · ${currentMessage.scene}` : ""}</Text>
          {currentMessage.answer ? <HStack>
            <Button title={showAnswer ? "收起答案" : "查看答案"} buttonStyle="plain" disabled={loading} action={() => setShowAnswer(!showAnswer)} />
            {showAnswer ? <Button title="填入答案" buttonStyle="bordered" disabled={loading} action={fillAnswer} /> : null}
          </HStack> : null}
          {showAnswer && currentMessage.answer ? <Text modifiers={modifiers().font(14).foregroundStyle("label")}>{currentMessage.answer}</Text> : null}
        </VStack> : <Text modifiers={modifiers().font(14).foregroundStyle("secondaryLabel")}>点上方胶囊，抽取一条消息</Text>}
      </VStack>

      <HStack spacing={8}>
        <Button title="上一句" buttonStyle="plain" disabled={loading || !previousMessage} action={showPrevious} />
        <Spacer />
        <Text modifiers={modifiers().font(11).foregroundStyle("secondaryLabel")}>{currentCategory?.title || "选择分类"}{currentMessage?.scene ? ` · ${currentMessage.scene}` : ""}</Text>
        <Spacer />
        <Text modifiers={modifiers().font(11).foregroundStyle("secondaryLabel")}>点选填入，不自动发送</Text>
      </HStack>
    </VStack>
  )
}

CustomKeyboard.requestHeight(320)
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
