import { Button, Form, HStack, Navigation, NavigationStack, Picker, Script, Section, Spacer, Text, TextField, Toggle, VStack, modifiers, useState } from "scripting"
import { openLocalMessageStore } from "./message-store.js"
import type { MessageStore } from "./message-store.js"
import type { LibraryChange, MessageLibrary, QuickMessage } from "./quick-messages.js"

function MessageEditor({ categoryTitle, message, onSave }: { categoryTitle: string; message?: QuickMessage; onSave: (text: string, answer: string) => Promise<void> }) {
  const dismiss = Navigation.useDismiss()
  const [text, setText] = useState(message?.text || "")
  const [answer, setAnswer] = useState(message?.answer || "")
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("点选消息只填入正文，答案可在键盘中单独查看。")
  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await onSave(text, answer)
      dismiss()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }
  return <NavigationStack>
    <Form formStyle="grouped" navigationTitle={message ? "编辑消息" : "新增消息"} navigationBarTitleDisplayMode="inline" toolbar={{
      topBarLeading: <Button title="取消" disabled={saving} action={dismiss} />,
      topBarTrailing: <Button title={saving ? "保存中…" : "保存"} disabled={saving || !text.trim()} action={() => { void save() }} />,
    }}>
      <Section header={<Text>{categoryTitle}</Text>} footer={<Text>{notice}</Text>}>
        <TextField title="消息内容" prompt="填写点选后要插入的文字" axis="vertical" lineLimit={{ min: 4, max: 8 }} value={text} onChanged={setText} />
        <TextField title="答案（可选）" prompt="脑筋急转弯的答案" axis="vertical" lineLimit={{ min: 2, max: 4 }} value={answer} onChanged={setAnswer} />
      </Section>
    </Form>
  </NavigationStack>
}

function MessageSettings({ store, initialLibrary }: { store: MessageStore; initialLibrary: MessageLibrary }) {
  const dismiss = Navigation.useDismiss()
  const [library, setLibrary] = useState<MessageLibrary>(initialLibrary)
  const [selectedId, setSelectedId] = useState(library.defaultCategoryId)
  const [notice, setNotice] = useState("点选消息可编辑，设置会在重新打开键盘后生效。")
  const [search, setSearch] = useState("")
  const [pageIndex, setPageIndex] = useState(0)
  const category = library.categories.find((item) => item.id === selectedId) || library.categories[0]
  const defaultOptions = library.categories.filter((item) => item.enabled && item.messages.length > 0)
  const query = search.trim().toLowerCase()
  const messages = category.messages.filter((message) => `${message.text}\n${message.answer || ""}`.toLowerCase().includes(query))
  const pageCount = Math.max(1, Math.ceil(messages.length / 20))
  const currentPage = Math.min(pageIndex, pageCount - 1)
  const visibleMessages = messages.slice(currentPage * 20, (currentPage + 1) * 20)

  async function persist(change: LibraryChange): Promise<MessageLibrary> {
    const next = await store.change(change)
    setLibrary(next)
    setNotice("已保存，重新打开键盘即可使用。")
    return next
  }

  async function commit(change: LibraryChange): Promise<MessageLibrary | null> {
    try { return await persist(change) }
    catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败，请重试")
      return null
    }
  }

  async function openEditor(message?: QuickMessage) {
    await Navigation.present({ element: <MessageEditor categoryTitle={category.title} message={message} onSave={async (text, answer) => {
      await persist({ type: "message.save", categoryId: category.id, id: message?.id, text, answer })
    }} />, modalPresentationStyle: "pageSheet" })
  }

  async function addCategory() {
    const title = await Dialog.prompt({ title: "新增分类", placeholder: "例如：开黑回怼", confirmLabel: "添加", cancelLabel: "取消" })
    if (title === null) return
    const next = await commit({ type: "category.add", title })
    if (next) { setSelectedId(next.categories[next.categories.length - 1].id); setSearch(""); setPageIndex(0) }
  }

  async function renameCategory() {
    const title = await Dialog.prompt({ title: "重命名分类", defaultValue: category.title, confirmLabel: "保存", cancelLabel: "取消" })
    if (title !== null) await commit({ type: "category.update", categoryId: category.id, title })
  }

  async function removeCategory() {
    const confirmed = await Dialog.confirm({ title: `删除“${category.title}”？`, message: "分类中的消息也会一并删除。", confirmLabel: "删除", cancelLabel: "取消" })
    if (!confirmed) return
    const next = await commit({ type: "category.remove", categoryId: category.id })
    if (next) { setSelectedId(next.defaultCategoryId); setSearch(""); setPageIndex(0) }
  }

  async function removeMessage(message: QuickMessage) {
    const confirmed = await Dialog.confirm({ title: "删除这条消息？", message: message.text, confirmLabel: "删除", cancelLabel: "取消" })
    if (confirmed) await commit({ type: "message.remove", categoryId: category.id, id: message.id })
  }

  return (
    <NavigationStack>
      <Form formStyle="grouped" navigationTitle="快捷消息" navigationBarTitleDisplayMode="inline" toolbar={{ topBarTrailing: <Button title="完成" action={dismiss} /> }}>
        <Section header={<Text>键盘</Text>} footer={<Text>消息保存在本地数据库。点选只填入文本，发送前可自行修改。</Text>}>
          <HStack><Text>消息总数</Text><Spacer /><Text>{library.categories.reduce((total, item) => total + item.messages.length, 0)} 条</Text></HStack>
          {defaultOptions.length ? <Picker title="默认分类" pickerStyle="menu" value={library.defaultCategoryId} onChanged={(value: string) => { void commit({ type: "preferences", defaultCategoryId: value }) }}>
            {defaultOptions.map((item) => <Text key={item.id} tag={item.id}>{item.title}</Text>)}
          </Picker> : <Text>添加消息后可设置默认分类。</Text>}
          <Toggle title="按键音" value={library.soundEnabled} onChanged={(soundEnabled) => { void commit({ type: "preferences", soundEnabled }) }} />
        </Section>

        <Section header={<Text>分类管理</Text>}>
          <Picker title="当前分类" pickerStyle="menu" value={category.id} onChanged={(id: string) => { setSelectedId(id); setSearch(""); setPageIndex(0) }}>
            {library.categories.map((item) => <Text key={item.id} tag={item.id}>{item.title} · {item.messages.length}</Text>)}
          </Picker>
          <Toggle title="在键盘中显示" value={category.enabled} onChanged={(enabled) => { void commit({ type: "category.update", categoryId: category.id, enabled }) }} />
          <Button title="重命名分类" action={() => { void renameCategory() }} />
          <Button title="新增分类" systemImage="plus" action={() => { void addCategory() }} />
          <Button title="删除当前分类" role="destructive" disabled={library.categories.length === 1} action={() => { void removeCategory() }} />
        </Section>

        <Section header={<Text>{category.title} · {category.messages.length} 条</Text>} footer={<Text>{notice}</Text>}>
          <Button title="添加消息" systemImage="plus" action={() => { void openEditor() }} />
          <TextField title="搜索当前分类" prompt="搜索消息或答案" value={search} onChanged={(value) => { setSearch(value); setPageIndex(0) }} />
          {visibleMessages.length ? visibleMessages.map((message) => (
            <HStack key={message.id} spacing={12}>
              <Button buttonStyle="plain" action={() => { void openEditor(message) }}>
                <VStack alignment="leading" spacing={4} modifiers={modifiers().frame({ maxWidth: "infinity", alignment: "leading" })}>
                  <Text modifiers={modifiers().foregroundStyle("label")}>{message.text}</Text>
                  {message.answer ? <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>答案：{message.answer}</Text> : null}
                </VStack>
              </Button>
              <Spacer />
              <Button title="删除" role="destructive" buttonStyle="borderless" action={() => { void removeMessage(message) }} />
            </HStack>
          )) : <Text>{query ? "没有匹配的消息。" : "还没有消息，点“添加消息”开始。"}</Text>}
          {pageCount > 1 ? <HStack>
            <Button title="上一页" buttonStyle="borderless" disabled={currentPage === 0} action={() => setPageIndex(currentPage - 1)} />
            <Spacer /><Text>{currentPage + 1} / {pageCount}</Text><Spacer />
            <Button title="下一页" buttonStyle="borderless" disabled={currentPage + 1 >= pageCount} action={() => setPageIndex(currentPage + 1)} />
          </HStack> : null}
        </Section>
      </Form>
    </NavigationStack>
  )
}

Script.enableMinimize(false)
async function run() {
  try {
    const store = await openLocalMessageStore()
    const initialLibrary = await store.readLibrary()
    await Navigation.present({ element: <MessageSettings store={store} initialLibrary={initialLibrary} />, modalPresentationStyle: "fullScreen" })
  } catch (error) {
    await Dialog.alert({ title: "无法打开消息库", message: error instanceof Error ? error.message : "请重新运行脚本", buttonLabel: "关闭" })
  } finally { Script.exit() }
}
void run()
