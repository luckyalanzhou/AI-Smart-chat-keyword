import { Button, HStack, ScrollView, Spacer, Text, VStack, modifiers, useState } from "scripting"
import { openLocalMessageStore } from "./message-store.js"
import type { DatabasePage, MessageStore } from "./message-store.js"

let activeQuery = 0

function QuickMessageKeyboard({ store, initialPage }: { store: MessageStore; initialPage: DatabasePage }) {
  const [page, setPage] = useState<DatabasePage>(initialPage)
  const [loading, setLoading] = useState(false)
  const [revealedId, setRevealedId] = useState("")
  const [notice, setNotice] = useState("点选填入")

  function insert(text: string) {
    try {
      CustomKeyboard.insertText(text)
    } catch {
      setNotice("请先点选输入框")
      return
    }
    setNotice("已填入")
    if (page.soundEnabled) {
      try { CustomKeyboard.playInputClick() } catch { /* Audio feedback is optional. */ }
    }
  }

  async function showPage(id: string, index: number) {
    const requestId = ++activeQuery
    setLoading(true)
    setRevealedId("")
    try {
      const next = await store.readPage(id, index)
      if (requestId !== activeQuery) return
      setPage(next)
      setNotice("点选填入")
    } catch {
      if (requestId === activeQuery) setNotice("读取失败，请重试")
    } finally {
      if (requestId === activeQuery) setLoading(false)
    }
  }

  function randomPage() {
    const index = Math.floor(Math.random() * (page.pageCount - 1))
    void showPage(page.categoryId, index >= page.index ? index + 1 : index)
  }

  return (
    <VStack alignment="leading" spacing={8} padding={{ horizontal: 12, vertical: 8 }} background="secondarySystemBackground" modifiers={modifiers().frame({ maxWidth: "infinity", maxHeight: "infinity" })}>
      <HStack spacing={8}>
        <Text modifiers={modifiers().font(16).bold().foregroundStyle("label")}>快捷消息</Text>
        <Spacer />
        <Text modifiers={modifiers().font(11).foregroundStyle("secondaryLabel")}>{loading ? "读取中…" : notice}</Text>
        <Button title="换一组" buttonStyle="plain" disabled={loading || page.pageCount < 2} action={randomPage} />
        <Button title="完成" buttonStyle="plain" action={() => CustomKeyboard.dismiss()} />
      </HStack>

      <ScrollView axes="horizontal" scrollIndicator="hidden" modifiers={modifiers().frame({ height: 38 })}>
        <HStack spacing={6}>
          {page.categories.map((category) => (
            <Button key={category.id} title={category.title} buttonStyle={category.id === page.categoryId ? "borderedProminent" : "bordered"} buttonBorderShape="capsule" controlSize="small" action={() => { void showPage(category.id, 0) }} />
          ))}
        </HStack>
      </ScrollView>

      <ScrollView axes="vertical" modifiers={modifiers().frame({ maxWidth: "infinity", maxHeight: "infinity" })}>
        <VStack alignment="leading" spacing={7} modifiers={modifiers().frame({ maxWidth: "infinity" })}>
          {page.messages.length ? page.messages.map((message) => (
            <VStack key={message.id} alignment="leading" spacing={5} modifiers={modifiers().frame({ maxWidth: "infinity" })}>
              <HStack spacing={6}>
                <Button buttonStyle="bordered" disabled={loading} buttonBorderShape={{ roundedRectangleRadius: 10 }} action={() => { if (!loading) insert(message.text) }} modifiers={modifiers().frame({ maxWidth: "infinity", alignment: "leading" })}>
                  <Text modifiers={modifiers().font(14).foregroundStyle("label").frame({ maxWidth: "infinity", minHeight: 36, alignment: "leading" })}>{message.text}</Text>
                </Button>
                {message.answer ? <Button title={revealedId === message.id ? "收起" : "答案"} buttonStyle="plain" disabled={loading} controlSize="small" action={() => setRevealedId(revealedId === message.id ? "" : message.id)} /> : null}
              </HStack>
              {message.answer && revealedId === message.id ? <Button buttonStyle="bordered" disabled={loading} action={() => { if (!loading) insert(message.answer!) }}>
                <Text modifiers={modifiers().font(13).foregroundStyle("tint")}>填入答案：{message.answer}</Text>
              </Button> : null}
            </VStack>
          )) : <VStack alignment="leading" spacing={6} padding={{ vertical: 18 }}>
            <Text modifiers={modifiers().font(14).foregroundStyle("secondaryLabel")}>这个分类还没有消息</Text>
            <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>打开脚本，在分类中添加即可。</Text>
          </VStack>}
        </VStack>
      </ScrollView>

      <HStack spacing={12}>
        <Button title="上一页" buttonStyle="plain" disabled={loading || page.index === 0} action={() => { void showPage(page.categoryId, page.index - 1) }} />
        <Spacer />
        <Text modifiers={modifiers().font(11).foregroundStyle("secondaryLabel")}>{page.index + 1} / {page.pageCount} · {page.total} 条</Text>
        <Spacer />
        <Button title="下一页" buttonStyle="plain" disabled={loading || page.index + 1 >= page.pageCount} action={() => { void showPage(page.categoryId, page.index + 1) }} />
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
    element = <QuickMessageKeyboard store={store} initialPage={initialPage} />
  } catch {
    element = <VStack spacing={12} padding>
      <Text>消息库未能打开，请先在 Scripting 中运行脚本后重试。</Text>
      <Button title="完成" action={() => CustomKeyboard.dismiss()} />
    </VStack>
  }
  CustomKeyboard.present(element)
}
void run()
