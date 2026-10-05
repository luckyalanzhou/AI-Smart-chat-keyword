import { Navigation, NavigationStack, Form, Section, HStack, Text, TextField, SecureField, Button, Picker, modifiers, useState, useEffect, useCallback, useMemo, fetch, Script } from "scripting"
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
  "DeepSeek": { endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash" },
  "通义千问": { endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-turbo" },
  "智谱AI": { endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash" },
  "月之暗面": { endpoint: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k" },
  "Google Gemini": { endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", model: "gemini-2.0-flash" },
  "自定义兼容接口": { endpoint: "https://api.openai.com/v1/chat/completions", model: "" }
}
const defaultAI: AIConfig = { provider: "OpenAI", ...providerDefaults.OpenAI, apiKey: "" }
const normalizeAI = (config: AIConfig): AIConfig => config.provider === "DeepSeek" && ["deepseek-chat", "deepseek-reasoner"].includes(config.model)
  ? { ...config, model: "deepseek-v4-flash" }
  : config
let modelRequestId = 0
let modelRequest: AbortController | null = null

const providers = Object.keys(providerDefaults) as AIProvider[]
const clampAge = (value: string) => Math.max(1, Math.min(120, Number(value) || 25))
const listModelsURL = (config: AIConfig) => config.provider === "Google Gemini"
  ? "https://generativelanguage.googleapis.com/v1beta/models"
  : config.endpoint.replace(/\/chat\/completions\/?$/, "/models")

function App() {
  const dismiss = Navigation.useDismiss()
  const [profile, setProfile] = useState<Profile>((Storage.get<Profile>("profile", { shared: true }) || defaultProfile))
  const storedAI = Storage.get<AIConfig>("ai", { shared: true }) || defaultAI
  const initialAI = normalizeAI(storedAI)
  const [ai, setAI] = useState<AIConfig>(initialAI)
  const [showKey, setShowKey] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(initialAI.provider === "自定义兼容接口")
  const [models, setModels] = useState<string[]>([])
  const [modelNotice, setModelNotice] = useState("填写 API Key 后会自动读取可用模型")
  useEffect(() => { if (initialAI.model !== storedAI.model) Storage.set("ai", initialAI, { shared: true }) }, [])
  const saveProfile = useCallback((next: Profile) => {
    setProfile(next)
    Storage.set("profile", next, { shared: true })
  }, [])
  const saveAI = useCallback((next: AIConfig) => {
    // Any configuration edit invalidates an in-flight model request. Otherwise
    // a response based on an older key/endpoint could write that stale config
    // back when it selects the first available model.
    modelRequestId++
    modelRequest?.abort()
    modelRequest = null
    setAI(next)
    Storage.set("ai", next, { shared: true })
  }, [])
  const refreshModels = useCallback(async () => {
    const requestId = ++modelRequestId
    modelRequest?.abort()
    const controller = new AbortController()
    modelRequest = controller
    // Read the just-saved shared config so a provider switch never uses the
    // previous provider's endpoint or model while the state update is pending.
    const config = Storage.get<AIConfig>("ai", { shared: true }) || ai
    if (!config.apiKey.trim()) { setModelNotice("请先填写 API Key"); return }
    setModelNotice("正在读取最新模型…")
    try {
      const gemini = config.provider === "Google Gemini"
      const url = listModelsURL(config)
      const response = await fetch(url, { signal: controller.signal, headers: gemini ? { "x-goog-api-key": config.apiKey.trim() } : { Authorization: `Bearer ${config.apiKey.trim()}` } })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`)
      const values = gemini
        ? (Array.isArray(data?.models) ? data.models.filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")).map((m: any) => String(m.name || "").replace(/^models\//, "")).filter((m: string) => m) : [])
        : (Array.isArray(data?.data) ? data.data.map((m: any) => String(m.id || "")).filter((m: string) => m) : [])
      if (!values.length) throw new Error("没有读取到模型")
      if (requestId !== modelRequestId) return
      setModels(values)
      // Use the current config. The request may have been started with an
      // older snapshot, and must never restore an old key or endpoint.
      const latest = Storage.get<AIConfig>("ai", { shared: true }) || ai
      if (latest.provider !== config.provider || latest.endpoint !== config.endpoint || latest.apiKey !== config.apiKey) return
      if (!values.includes(latest.model)) saveAI({ ...latest, model: values[0] })
      setModelNotice(`已读取 ${values.length} 个可用模型`)
    } catch (error) {
      if (requestId !== modelRequestId || (error as any)?.name === "AbortError") return
      setModels([])
      setModelNotice(`读取失败：${String(error).replace("Error: ", "")}`)
    }
  }, [ai, saveAI])
  const changeProvider = useCallback((provider: AIProvider) => {
    modelRequestId++
    modelRequest?.abort()
    modelRequest = null
    setModels([])
    setModelNotice("正在准备读取模型…")
    setShowAdvanced(provider === "自定义兼容接口")
    const storedKeys = Storage.get<Record<AIProvider, string>>("aiKeys", { shared: true }) || {} as Record<AIProvider, string>
    storedKeys[ai.provider] = ai.apiKey
    const next = { ...ai, provider, ...providerDefaults[provider], apiKey: storedKeys[provider] || "" }
    storedKeys[provider] = next.apiKey
    Storage.set("aiKeys", storedKeys, { shared: true })
    saveAI(next)
  }, [ai, saveAI])
  const keyField = useMemo(
    () => showKey
      ? <TextField title="API Key" prompt="粘贴服务商 API Key" value={ai.apiKey} onChanged={(value) => saveAI({ ...ai, apiKey: value })} modifiers={modifiers().frame({ maxWidth: "infinity" })} />
      : <SecureField title="API Key" prompt="粘贴服务商 API Key" value={ai.apiKey} onChanged={(value) => saveAI({ ...ai, apiKey: value })} modifiers={modifiers().frame({ maxWidth: "infinity" })} />,
    [ai, saveAI, showKey],
  )
  useEffect(() => {
    const storedKeys = Storage.get<Record<AIProvider, string>>("aiKeys", { shared: true }) || {} as Record<AIProvider, string>
    if (storedKeys[ai.provider] !== ai.apiKey) {
      storedKeys[ai.provider] = ai.apiKey
      Storage.set("aiKeys", storedKeys, { shared: true })
    }
    if (ai.apiKey.trim()) void refreshModels()
  }, [ai.provider])

  return (
    <NavigationStack>
      <Form
        formStyle="grouped"
        navigationTitle="智能聊天键盘"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarTrailing: <Button title="关闭" systemImage="xmark" action={dismiss} /> }}
      >
        <Section header={<Text>回复风格</Text>} footer={<Text>这些设置只用于调整回复语气，并通过共享存储供键盘读取。</Text>}>
          <Picker title="性别" pickerStyle="menu" value={profile.gender} onChanged={(value: any) => saveProfile({ ...profile, gender: value as Gender })}>{(["女", "男", "不透露"] as Gender[]).map((gender) => <Text tag={gender}>{gender}</Text>)}</Picker>
          <TextField title="年龄" value={String(profile.age)} onChanged={(value) => saveProfile({ ...profile, age: clampAge(value) })} />
          <Picker title="当前状态" pickerStyle="menu" value={moods.indexOf(profile.mood)} onChanged={(value: any) => saveProfile({ ...profile, mood: moods[Number(value)] || "普通" })}>{moods.map((mood, index) => <Text tag={index}>{mood}</Text>)}</Picker>
          <Picker title="性格" pickerStyle="menu" value={profile.personality === "内向" ? 0 : 1} onChanged={(value: any) => saveProfile({ ...profile, personality: Number(value) === 0 ? "内向" : "外向" })}><Text tag={0}>内向</Text><Text tag={1}>外向</Text></Picker>
          <Picker title="表达风格" pickerStyle="menu" value={tones.indexOf(profile.tone)} onChanged={(value: any) => saveProfile({ ...profile, tone: tones[Number(value)] || "温柔" })}>{tones.map((tone, index) => <Text tag={index}>{tone}</Text>)}</Picker>
        </Section>

        <Section header={<Text>AI 服务</Text>} footer={<Text>{modelNotice}</Text>}>
          <Picker title="服务商" pickerStyle="menu" value={ai.provider} onChanged={(value: any) => changeProvider(value as AIProvider)}>{providers.map((provider) => <Text tag={provider}>{provider}</Text>)}</Picker>
          <HStack>
            {keyField}
            <Button title={showKey ? "隐藏" : "显示"} systemImage={showKey ? "eye" : "eye.slash"} action={() => setShowKey(!showKey)} />
          </HStack>
          <HStack>
            {models.length > 0
              ? <Picker title="模型" pickerStyle="menu" value={ai.model} onChanged={(v: any) => saveAI({ ...ai, model: v as string })}>{models.map((model) => <Text tag={model}>{model}</Text>)}</Picker>
              : <TextField title="模型" prompt="填写模型名称" value={ai.model} onChanged={(v) => saveAI({ ...ai, model: v })} />}
            <Button title="刷新模型" systemImage="arrow.clockwise" action={() => { void refreshModels() }} />
          </HStack>
        </Section>

        <Section header={<Text>高级设置</Text>}>
          <Button title={showAdvanced ? "收起接口设置" : "自定义接口地址"} systemImage={showAdvanced ? "chevron.up" : "chevron.down"} action={() => setShowAdvanced(!showAdvanced)} />
          {showAdvanced ? <TextField title="接口地址" prompt="https://…/chat/completions" value={ai.endpoint} onChanged={(v) => saveAI({ ...ai, endpoint: v })} /> : null}
        </Section>
      </Form>
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
