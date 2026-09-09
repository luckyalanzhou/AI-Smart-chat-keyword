import { Navigation, NavigationStack, ScrollView, VStack, HStack, Text, TextField, SecureField, Button, Picker, RoundedRectangle, modifiers, useState, useEffect, useCallback, useMemo, fetch, Script } from "scripting"
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
const providers = Object.keys(providerDefaults) as AIProvider[]
const clampAge = (value: string) => Math.max(1, Math.min(120, Number(value) || 25))
const listModelsURL = (config: AIConfig) => config.provider === "Google Gemini"
  ? "https://generativelanguage.googleapis.com/v1beta/models"
  : config.endpoint.replace(/\/chat\/completions\/?$/, "/models")

const glassBorder = (cornerRadius: number) => (
  <RoundedRectangle
    cornerRadius={cornerRadius}
    stroke={{
      shapeStyle: { light: "rgba(255,255,255,0.72)", dark: "rgba(255,255,255,0.20)" },
      strokeStyle: { lineWidth: 1 },
    }}
  />
)

function SettingsCard({ title, detail, eyebrow, children }: { title: string; detail?: string; eyebrow?: string; children: any }) {
  return (
    <VStack
      alignment="leading"
      spacing={13}
      padding={18}
      glassEffect={{ type: "rect", cornerRadius: 24 }}
      overlay={glassBorder(24)}
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

function App() {
  const dismiss = Navigation.useDismiss()
  const [profile, setProfile] = useState<Profile>((Storage.get<Profile>("profile", { shared: true }) || defaultProfile))
  const storedAI = Storage.get<AIConfig>("ai", { shared: true }) || defaultAI
  const initialAI = normalizeAI(storedAI)
  const [ai, setAI] = useState<AIConfig>(initialAI)
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelNotice, setModelNotice] = useState("填写 API Key 后会自动读取可用模型")
  useEffect(() => { if (initialAI.model !== storedAI.model) Storage.set("ai", initialAI, { shared: true }) }, [])
  const saveProfile = useCallback((next: Profile) => {
    setProfile(next)
    Storage.set("profile", next, { shared: true })
  }, [])
  const saveAI = useCallback((next: AIConfig) => {
    setAI(next)
    Storage.set("ai", next, { shared: true })
  }, [])
  const refreshModels = useCallback(async () => {
    // Read the just-saved shared config so a provider switch never uses the
    // previous provider's endpoint or model while the state update is pending.
    const config = Storage.get<AIConfig>("ai", { shared: true }) || ai
    if (!config.apiKey.trim()) { setModelNotice("请先填写 API Key"); return }
    setModelNotice("正在读取最新模型…")
    try {
      const gemini = config.provider === "Google Gemini"
      const url = listModelsURL(config)
      const response = await fetch(url, { headers: gemini ? { "x-goog-api-key": config.apiKey.trim() } : { Authorization: `Bearer ${config.apiKey.trim()}` } })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`)
      const values = gemini
        ? (Array.isArray(data?.models) ? data.models.filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")).map((m: any) => String(m.name || "").replace(/^models\//, "")).filter((m: string) => m) : [])
        : (Array.isArray(data?.data) ? data.data.map((m: any) => String(m.id || "")).filter((m: string) => m) : [])
      if (!values.length) throw new Error("没有读取到模型")
      setModels(values)
      if (!values.includes(config.model)) saveAI({ ...config, model: values[0] })
      setModelNotice(`已读取 ${values.length} 个可用模型`)
    } catch (error) { setModels([]); setModelNotice(`读取失败：${String(error).replace("Error: ", "")}`) }
  }, [ai, saveAI])
  const changeProvider = useCallback((provider: AIProvider) => {
    setModels([])
    setModelNotice("正在准备读取模型…")
    saveAI({ ...ai, provider, ...providerDefaults[provider] })
  }, [ai, saveAI])
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
          spacing={16}
          padding={{ horizontal: 16, vertical: 20 }}
          background="systemBackground"
          navigationTitle="智能聊天键盘"
          navigationBarTitleDisplayMode="inline"
          toolbar={{ topBarTrailing: <Button title="关闭" systemImage="xmark" action={dismiss} /> }}
          modifiers={modifiers().frame({ maxWidth: "infinity" })}
        >
          <SettingsCard eyebrow="01" title="回复风格">
            <HStack spacing={12} modifiers={modifiers().frame({ maxWidth: "infinity" })}>
              <Picker title="性别" value={profile.gender} onChanged={(value: any) => saveProfile({ ...profile, gender: value as Gender })} modifiers={modifiers().frame({ maxWidth: "infinity" })}>{(["女", "男", "不透露"] as Gender[]).map((gender) => <Text tag={gender}>{gender}</Text>)}</Picker>
              <TextField title="年龄" value={String(profile.age)} onChanged={(value) => saveProfile({ ...profile, age: clampAge(value) })} modifiers={modifiers().frame({ maxWidth: "infinity" })} />
            </HStack>
            <HStack spacing={12} modifiers={modifiers().frame({ maxWidth: "infinity" })}>
              <Picker title="当前状态" value={moods.indexOf(profile.mood)} onChanged={(value: any) => saveProfile({ ...profile, mood: moods[Number(value)] || "普通" })} modifiers={modifiers().frame({ maxWidth: "infinity" })}>{moods.map((mood, index) => <Text tag={index}>{mood}</Text>)}</Picker>
              <Picker title="性格" value={profile.personality === "内向" ? 0 : 1} onChanged={(value: any) => saveProfile({ ...profile, personality: Number(value) === 0 ? "内向" : "外向" })} modifiers={modifiers().frame({ maxWidth: "infinity" })}><Text tag={0}>内向</Text><Text tag={1}>外向</Text></Picker>
            </HStack>
            <Picker title="表达风格" value={tones.indexOf(profile.tone)} onChanged={(value: any) => saveProfile({ ...profile, tone: tones[Number(value)] || "温柔" })}>{tones.map((tone, index) => <Text tag={index}>{tone}</Text>)}</Picker>
          </SettingsCard>

          <SettingsCard eyebrow="02" title="AI 服务">
          <Picker title="服务商" value={ai.provider} onChanged={(value: any) => changeProvider(value as AIProvider)}>{providers.map((provider) => <Text tag={provider}>{provider}</Text>)}</Picker>
          <HStack spacing={8}>{keyField}<Button title="" systemImage={showKey ? "eye" : "eye.slash"} action={() => setShowKey(!showKey)} /></HStack>
          {models.length > 0 ? <Picker title="模型（已读取）" value={ai.model} onChanged={(v: any) => saveAI({ ...ai, model: v as string })}>{models.map((model) => <Text tag={model}>{model}</Text>)}</Picker> : <TextField title="模型名称" value={ai.model} onChanged={(v) => saveAI({ ...ai, model: v })} />}
          <Button title="刷新可用模型" buttonStyle="glassProminent" action={() => { void refreshModels() }} />
          <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>{modelNotice}</Text>
          <TextField title="接口地址" value={ai.endpoint} onChanged={(v) => saveAI({ ...ai, endpoint: v })} />
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
