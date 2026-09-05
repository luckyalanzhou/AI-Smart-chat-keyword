import { Navigation, NavigationStack, ScrollView, VStack, HStack, Text, TextField, SecureField, Button, Picker, modifiers, useState, useEffect, useCallback, useMemo, fetch, Script } from "scripting"
type Gender = "女" | "男" | "不透露"
type Mood = "开心" | "忙碌" | "疲惫" | "难过" | "生气" | "暧昧" | "相亲" | "普通"
type Profile = { gender: Gender; age: number; mood: Mood; personality: "内向" | "外向"; tone: "温柔" | "活泼" | "成熟" | "简洁" | "土味情话" | "连环屁" }
const defaultProfile: Profile = { gender: "不透露", age: 25, mood: "普通", personality: "外向", tone: "温柔" }
const moods: Mood[] = ["开心", "忙碌", "疲惫", "难过", "生气", "暧昧", "相亲", "普通"]
const tones: Profile["tone"][] = ["温柔", "活泼", "成熟", "简洁", "土味情话", "连环屁"]
type AIProvider = "OpenAI" | "DeepSeek" | "通义千问" | "智谱AI" | "月之暗面" | "Google Gemini" | "自定义兼容接口"
type AIConfig = { provider: AIProvider; endpoint: string; model: string; apiKey: string }
const providerDefaults: Record<AIProvider, { endpoint: string; model: string }> = {
  "OpenAI": { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  "DeepSeek": { endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  "通义千问": { endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-turbo" },
  "智谱AI": { endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash" },
  "月之暗面": { endpoint: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k" },
  "Google Gemini": { endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", model: "gemini-2.0-flash" },
  "自定义兼容接口": { endpoint: "https://api.openai.com/v1/chat/completions", model: "" }
}
const defaultAI: AIConfig = { provider: "OpenAI", ...providerDefaults.OpenAI, apiKey: "" }
const providers = Object.keys(providerDefaults) as AIProvider[]
const clampAge = (value: string) => Math.max(1, Math.min(120, Number(value) || 25))
const listModelsURL = (config: AIConfig) => config.provider === "Google Gemini"
  ? "https://generativelanguage.googleapis.com/v1beta/models"
  : config.endpoint.replace(/\/chat\/completions\/?$/, "/models")

function SettingsCard({ title, detail, eyebrow, children }: { title: string; detail?: string; eyebrow?: string; children: any }) {
  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={14}
      background="secondarySystemBackground"
      modifiers={modifiers().frame({ maxWidth: "infinity" })}
    >
      <VStack alignment="leading" spacing={3}>
        {eyebrow ? <Text modifiers={modifiers().font(10).bold().foregroundStyle("tertiaryLabel")}>{eyebrow}</Text> : null}
        <Text modifiers={modifiers().font(16).bold().foregroundStyle("label")}>{title}</Text>
        {detail ? <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>{detail}</Text> : null}
      </VStack>
      {children}
    </VStack>
  )
}

function StatusItem({ title, value, active }: { title: string; value: string; active: boolean }) {
  return (
    <VStack alignment="leading" spacing={2} padding={{ horizontal: 10, vertical: 8 }} background="tertiarySystemBackground" modifiers={modifiers().frame({ maxWidth: "infinity" })}>
      <Text modifiers={modifiers().font(10).foregroundStyle("secondaryLabel")}>{title}</Text>
      <Text modifiers={modifiers().font(12).bold().foregroundStyle(active ? "label" : "tertiaryLabel")}>{value}</Text>
    </VStack>
  )
}

function App() {
  const dismiss = Navigation.useDismiss()
  const [profile, setProfile] = useState<Profile>((Storage.get<Profile>("profile", { shared: true }) || defaultProfile))
  const [ai, setAI] = useState<AIConfig>(Storage.get<AIConfig>("ai", { shared: true }) || defaultAI)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelNotice, setModelNotice] = useState("填写 API Key 后会自动读取可用模型")
  const saveProfile = useCallback((next: Profile) => {
    setProfile(next)
    Storage.set("profile", next, { shared: true })
  }, [])
  const saveAI = useCallback((next: AIConfig) => {
    setAI(next)
    Storage.set("ai", next, { shared: true })
  }, [])
  const refreshModels = useCallback(async () => {
    if (!ai.apiKey.trim()) { setModelNotice("请先填写 API Key"); return }
    setModelNotice("正在读取最新模型…")
    try {
      const gemini = ai.provider === "Google Gemini"
      const url = gemini ? `${listModelsURL(ai)}?key=${encodeURIComponent(ai.apiKey.trim())}` : listModelsURL(ai)
      const response = await fetch(url, { headers: gemini ? {} : { Authorization: `Bearer ${ai.apiKey.trim()}` } })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`)
      const values = gemini
        ? (Array.isArray(data?.models) ? data.models.filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")).map((m: any) => String(m.name || "").replace(/^models\//, "")).filter((m: string) => m) : [])
        : (Array.isArray(data?.data) ? data.data.map((m: any) => String(m.id || "")).filter((m: string) => m) : [])
      if (!values.length) throw new Error("没有读取到模型")
      setModels(values)
      if (!values.includes(ai.model)) saveAI({ ...ai, model: values[0] })
      setModelNotice(`已读取 ${values.length} 个可用模型`)
    } catch (error) { setModels([]); setModelNotice(`读取失败：${String(error).replace("Error: ", "")}`) }
  }, [ai, saveAI])
  const changeProvider = useCallback((provider: AIProvider) => {
    setModels([])
    setModelNotice("正在准备读取模型…")
    saveAI({ ...ai, provider, ...providerDefaults[provider] })
  }, [ai, saveAI])
  const isReady = Boolean(ai.apiKey.trim() && ai.endpoint.trim() && ai.model.trim())
  const keyField = useMemo(
    () => showKey
      ? <TextField title="API Key" prompt="粘贴服务商提供的密钥" value={ai.apiKey} onChanged={(value) => saveAI({ ...ai, apiKey: value })} />
      : <SecureField title="API Key" prompt="粘贴服务商提供的密钥" value={ai.apiKey} onChanged={(value) => saveAI({ ...ai, apiKey: value })} />,
    [ai, saveAI, showKey],
  )
  useEffect(() => { if (ai.apiKey.trim()) void refreshModels() }, [ai.provider])

  return (
    <NavigationStack>
      <ScrollView>
        <VStack
          alignment="leading"
          spacing={14}
          padding={16}
          background="systemBackground"
          navigationTitle="智能聊天键盘"
          navigationBarTitleDisplayMode="inline"
          toolbar={{ topBarTrailing: <Button title="关闭" systemImage="xmark" action={dismiss} /> }}
          modifiers={modifiers().frame({ maxWidth: "infinity" })}
        >
          <VStack alignment="leading" spacing={7} padding={18} background="#5B5BD6" modifiers={modifiers().frame({ maxWidth: "infinity" })}>
            <Text modifiers={modifiers().font(11).bold().foregroundStyle("white")}>AI REPLY KEYBOARD</Text>
            <Text modifiers={modifiers().font(26).bold().foregroundStyle("white")}>自然地接上每句话</Text>
            <Text modifiers={modifiers().font(14).foregroundStyle("white")}>理解你主动粘贴的上下文，生成三条可编辑候选。</Text>
            <Text modifiers={modifiers().font(12).foregroundStyle("white")}>{isReady ? "已准备就绪 · 键盘内直接生成" : "还差一步 · 配置 AI 服务后即可使用"}</Text>
          </VStack>

          <SettingsCard eyebrow="当前状态" title={isReady ? "键盘已准备就绪" : "等待完成服务配置"} detail={isReady ? "设置会自动保存。切换到键盘后，粘贴聊天上下文即可生成。" : "填写 API Key 和模型名称后，键盘才能生成回复。"}>
            <HStack spacing={8} modifiers={modifiers().frame({ maxWidth: "infinity" })}>
              <StatusItem title="AI 服务" value={ai.provider} active={Boolean(ai.apiKey.trim())} />
              <StatusItem title="回复风格" value={profile.tone} active={true} />
              <StatusItem title="发送方式" value="手动确认" active={true} />
            </HStack>
          </SettingsCard>

          <SettingsCard eyebrow="01 · REPLY STYLE" title="回复风格" detail="这些偏好会同步到键盘；无需额外保存。">
          <Picker title="性别" value={profile.gender} onChanged={(value: any) => saveProfile({ ...profile, gender: value as Gender })}>{(["女", "男", "不透露"] as Gender[]).map((gender) => <Text tag={gender}>{gender}</Text>)}</Picker>
          <TextField title="年龄" value={String(profile.age)} onChanged={(value) => saveProfile({ ...profile, age: clampAge(value) })} />
          <Picker title="当前状态" value={moods.indexOf(profile.mood)} onChanged={(value: any) => saveProfile({ ...profile, mood: moods[Number(value)] || "普通" })}>{moods.map((mood, index) => <Text tag={index}>{mood}</Text>)}</Picker>
          <Picker title="性格" value={profile.personality === "内向" ? 0 : 1} onChanged={(value: any) => saveProfile({ ...profile, personality: Number(value) === 0 ? "内向" : "外向" })}><Text tag={0}>内向</Text><Text tag={1}>外向</Text></Picker>
          <Picker title="表达风格" value={tones.indexOf(profile.tone)} onChanged={(value: any) => saveProfile({ ...profile, tone: tones[Number(value)] || "温柔" })}>{tones.map((tone, index) => <Text tag={index}>{tone}</Text>)}</Picker>
          </SettingsCard>

          <SettingsCard eyebrow="02 · AI CONNECTION" title="AI 服务" detail="密钥保存在本机；只有你粘贴的聊天内容会发送到所选服务商。">
          <Picker title="服务商" value={ai.provider} onChanged={(value: any) => changeProvider(value as AIProvider)}>{providers.map((provider) => <Text tag={provider}>{provider}</Text>)}</Picker>
          <HStack spacing={8}>{keyField}<Button title="" systemImage={showKey ? "eye" : "eye.slash"} action={() => setShowKey(!showKey)} /></HStack>
          {models.length > 0 ? <Picker title="模型（已读取）" value={ai.model} onChanged={(v: any) => saveAI({ ...ai, model: v as string })}>{models.map((model) => <Text tag={model}>{model}</Text>)}</Picker> : <TextField title="模型名称" value={ai.model} onChanged={(v) => saveAI({ ...ai, model: v })} />}
          <Button title="刷新可用模型" action={() => { void refreshModels() }} />
          <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>{modelNotice}</Text>
          <TextField title="接口地址" value={ai.endpoint} onChanged={(v) => saveAI({ ...ai, endpoint: v })} />
          </SettingsCard>

          <SettingsCard eyebrow="03 · HOW IT WORKS" title="三步开始回复" detail="聊天记录由你主动粘贴；脚本不会读取其他 App 的聊天历史。">
            <HStack spacing={10} modifiers={modifiers().frame({ maxWidth: "infinity" })}>
              <StatusItem title="1" value="复制上下文" active={true} />
              <StatusItem title="2" value="键盘内粘贴" active={true} />
              <StatusItem title="3" value="点选插入" active={true} />
            </HStack>
            <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>请先在系统设置中为 Scripting 键盘开启“允许完全访问”，以便连接你选择的 AI 服务。</Text>
          </SettingsCard>
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}

// Keep the lifecycle aligned with the official Quick Start: the script exits
// only after the presented view has actually been dismissed.
Script.enableMinimize(false)
Navigation.present({
  element: <App />,
  modalPresentationStyle: "fullScreen",
}).then(() => Script.exit())
