import { VStack, HStack, Text, TextField, Button, Picker, modifiers, useState, fetch } from "scripting"
type Gender = "女" | "男" | "不透露"
type Mood = "开心" | "忙碌" | "疲惫" | "难过" | "生气" | "暧昧" | "相亲" | "普通"
type Profile = {
  gender: Gender
  age: number
  mood: Mood
  personality: "内向" | "外向"
  tone: "温柔" | "活泼" | "成熟" | "简洁" | "土味情话" | "连环屁"
}

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
const defaultProfile: Profile = { gender: "不透露", age: 25, mood: "普通", personality: "外向", tone: "温柔" }

function generateReplies(sentence: string, profile: Profile): string[] {
  const s = sentence.trim()
  if (!s) return ["嗯？你还没说完", "我在听，继续说", "怎么啦？"]
  const end = profile.tone === "简洁" ? "" : profile.age > 35 ? "呢" : "呀"
  // 先识别语气，再识别主题，避免只命中一个词就“已读乱回”。
  if (/没得了|就玩|只会|这么菜|行不行|可以啊你|厉害了/.test(s)) {
    return profile.tone === "活泼"
      ? ["哈哈，被你发现了，我就随便玩玩", "那你来推荐一个？", "不服，等我认真起来给你看"]
      : ["哈哈，刚好看到这个，就随便玩玩", "你觉得玩什么比较好？", "我就放松一下，怎么啦"]
  }
  if (/真的吗|真的假的|是吗|确定吗|不会吧|认真的吗/.test(s)) return ["真的呀，我没骗你", "你不信的话我可以解释一下", "哈哈，确实有点意外"]
  if (/[?？]|吗$|怎么|为什么|能不能|可以吗|啥意思|什么意思/.test(s)) return [`你的意思是……？${end}`, "我先确认一下，你是想说这个吗？", "可以，具体怎么安排？"]
  if (/哈哈|笑死|好玩|成功|喜欢|绝了|牛/.test(s)) return [`哈哈，听起来就很有意思${end}`, "这也太棒了，继续讲讲", "你开心就好，我也被带动了"]
  if (/累|疲惫|加班|忙|睡|困/.test(s)) return ["辛苦啦，忙完记得休息", "你先忙，晚点再聊也可以", "今天是不是特别累？"]
  if (/难过|伤心|委屈|失望|不开心/.test(s)) return ["怎么啦，我在听", "先抱抱你，别一个人憋着", "你愿意的话可以和我说说"]
  if (/生气|烦|讨厌|无语/.test(s)) return ["听着确实挺让人生气的", "先消消气，慢慢说发生什么了", "我站你这边，你想怎么处理？"]
  if (/吃|饭|饿/.test(s)) return ["你吃饭了吗？", "想吃什么？我帮你想想", "先去吃点东西，别饿着"]
  if (profile.mood === "忙碌") return ["我这会儿有点忙，晚点认真回你", "收到，我忙完找你", "先记下啦，等我一下"]
  if (profile.mood === "疲惫") return ["我今天有点累，晚点再聊好吗", "收到啦，我先缓一会儿", "今天状态一般，但我有在看"]
  if (profile.mood === "相亲") return ["和你聊天感觉挺舒服的，你平时周末喜欢做什么？", "这个话题挺有意思的，我也想听听你的想法", "我们可以慢慢了解，不用太有压力"]
  if (profile.tone === "土味情话") return ["你一开口，我这边的心就自动联网了", "你是Wi-Fi吗？我一靠近你就有感觉", "我本来想回三个字，后来发现是我想你"]
  if (profile.tone === "连环屁") return ["哈哈哈哈你说得对但我先笑为敬", "不是吧不是吧，这都被你发现了", "等一下让我组织语言，算了不组织了"]
  if (profile.tone === "活泼") return [`好哇好哇${end}！`, "哈哈收到，安排上了", "没问题，冲呀！"]
  return ["好哒，我看到啦", "嗯嗯，慢慢来就好", "谢谢你和我说这些"]
}

let lastInputLength = 0

function SmartReplyKeyboard() {
  const stored = Storage.get<Profile>("profile", { shared: true }) || defaultProfile
  const [profile, setProfile] = useState<Profile>(stored)
  const [ai, setAI] = useState<AIConfig>(Storage.get<AIConfig>("ai", { shared: true }) || defaultAI)
  const [sentence, setSentence] = useState("")
  const [replies, setReplies] = useState<string[]>(["先粘贴对方消息", "再点击生成回复", "点选即可插入"])
  const [notice, setNotice] = useState("点输入框后长按粘贴对方消息")
  const [busy, setBusy] = useState(false)
  const saveProfile = (next: Profile) => { setProfile(next); Storage.set("profile", next, { shared: true }) }

  const generate = async (input?: string) => {
    const text = (input ?? sentence).trim()
    if (!text) { setNotice("请先点输入框，然后长按粘贴对方消息"); return }
    if (!ai.apiKey.trim()) { setNotice("请先在主 App 设置 AI API Key"); return }
    setBusy(true)
    setNotice("AI 正在理解这句话…")
    try {
      const prompt = `对方原话：${text}\n用户人设：${profile.gender}，${profile.age}岁，${profile.personality}性格，当前${profile.mood}，风格${profile.tone}\n性格要求：内向就少说、少主动追问、语气克制但不冷淡；外向就自然主动、适度接话和追问，但不要过度热情。`
      const system = "你是聊天回复助手，不是客服。只根据对方原话回复，像普通人发微信一样说话。生成3条候选：自然、轻松、稍微带点情绪。每条只写一句，6到18个汉字，尽量口语、短、留白，不要解释，不要总结，不要‘我理解你的意思’‘收到啦’‘感谢分享’等AI套话，不要连续使用语气词，不要强行热情，不要编造事实。只输出JSON数组，例如：[\\\"行，那到时候见\\\",\\\"哈哈可以啊\\\",\\\"你想去哪儿？\\\"]。"
      const isGemini = ai.provider === "Google Gemini"
      const url = isGemini ? `${ai.endpoint.trim()}?key=${encodeURIComponent(ai.apiKey.trim())}` : ai.endpoint.trim()
      const body = isGemini
        ? { contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }], generationConfig: { temperature: 0.85, maxOutputTokens: 240 } }
        : { model: ai.model.trim(), temperature: 0.85, max_tokens: 240, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }
      const headers = isGemini ? { "Content-Type": "application/json" } : { "Content-Type": "application/json", "Authorization": `Bearer ${ai.apiKey.trim()}` }
      const response = await fetch(url, { method: "POST", headers: headers as any, body: JSON.stringify(body) })

      const data = await response.json()
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`)
      const content = isGemini ? (data?.candidates?.[0]?.content?.parts?.[0]?.text || "") : (data?.choices?.[0]?.message?.content || "")
      const match = content.match(/\[[\s\S]*\]/)
      const parsed = match ? JSON.parse(match[0]) : []
      const result = Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim().replace(/[。！？]+$/, "")).slice(0, 3) : []
      if (result.length === 0) throw new Error("AI 返回格式不正确")
      setReplies(result)
      setNotice("AI 已生成，点击回复插入；不会自动发送")
    } catch (error) {
      setNotice(`AI 请求失败：${String(error).replace("Error: ", "")}`)
    } finally { setBusy(false) }
  }
  const onSentenceChanged = (value: string) => {
    setSentence(value)
    // 粘贴通常会一次增加多个字符；普通逐字输入不会自动请求，避免浪费 API。
    if (value.trim().length >= 3 && value.length - lastInputLength >= 3) void generate(value)
    lastInputLength = value.length
  }
  const insert = (text: string) => {
    CustomKeyboard.insertText(text)
    CustomKeyboard.playInputClick()
    setNotice("已插入，是否发送由你确认")
  }

  return (
    <VStack alignment="leading" spacing={8} padding={12} background="systemBackground">
      <HStack spacing={7}>
        <Text modifiers={modifiers().font(18).foregroundStyle("label")}>智能回复</Text>
        <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>复制消息 → 粘贴 → 生成</Text>
      </HStack>
      <HStack spacing={6}>
        <Button action={() => { void generate() }}><Text modifiers={modifiers().font(14).foregroundStyle("label").padding({ horizontal: 13, vertical: 8 }).background("#635BFF")}>{busy ? "生成中…" : "生成回复"}</Text></Button>
        <Button action={() => { setSentence(""); lastInputLength = 0; setReplies(["先粘贴对方消息", "再点击生成回复", "点选即可插入"]); setNotice("点输入框粘贴对方消息") }}><Text modifiers={modifiers().font(14).foregroundStyle("label").padding({ horizontal: 13, vertical: 8 }).background("secondarySystemBackground")}>清空</Text></Button>
        <Button action={() => CustomKeyboard.deleteBackward()}><Text modifiers={modifiers().font(15).foregroundStyle("label").padding({ horizontal: 11, vertical: 8 }).background("secondarySystemBackground")}>⌫</Text></Button>
        <Button action={() => CustomKeyboard.dismiss()}><Text modifiers={modifiers().font(14).foregroundStyle("label").padding({ horizontal: 11, vertical: 8 }).background("secondarySystemBackground")}>完成</Text></Button>
      </HStack>
      <Text modifiers={modifiers().font(12).foregroundStyle("secondaryLabel")}>{notice}</Text>
      <TextField title="对方消息" prompt="点这里后长按粘贴，粘贴后自动生成" autofocus={true} value={sentence} onChanged={onSentenceChanged} />
      <HStack spacing={5}>
        <Text modifiers={modifiers().font(13).foregroundStyle("secondaryLabel")}>回复建议</Text>
        <Text modifiers={modifiers().font(11).foregroundStyle("tertiaryLabel")}>点击插入，不会自动发送</Text>
      </HStack>
      <VStack spacing={5} alignment="leading">
        {replies.map((reply) => <Button action={() => insert(reply)}><Text modifiers={modifiers().font(15).foregroundStyle("label").padding({ horizontal: 12, vertical: 9 }).background("tertiarySystemBackground")}>{reply}</Text></Button>)}
      </VStack>
      <HStack spacing={6}>
        <Picker title="状态" value={["开心", "忙碌", "疲惫", "难过", "生气", "暧昧", "相亲", "普通"].indexOf(profile.mood)} onChanged={(v: any) => saveProfile({ ...profile, mood: (["开心", "忙碌", "疲惫", "难过", "生气", "暧昧", "相亲", "普通"][Number(v)] || "普通") as Mood })}><Text tag={0}>开心</Text><Text tag={1}>忙碌</Text><Text tag={2}>疲惫</Text><Text tag={3}>难过</Text><Text tag={4}>生气</Text><Text tag={5}>暧昧</Text><Text tag={6}>相亲</Text><Text tag={7}>普通</Text></Picker>
        <Picker title="性格" value={profile.personality === "内向" ? 0 : 1} onChanged={(v: any) => saveProfile({ ...profile, personality: Number(v) === 0 ? "内向" : "外向" })}><Text tag={0}>内向</Text><Text tag={1}>外向</Text></Picker>
        <Picker title="风格" value={["温柔", "活泼", "成熟", "简洁", "土味情话", "连环屁"].indexOf(profile.tone)} onChanged={(v: any) => saveProfile({ ...profile, tone: (["温柔", "活泼", "成熟", "简洁", "土味情话", "连环屁"][Number(v)] || "温柔") as Profile["tone"] })}><Text tag={0}>温柔</Text><Text tag={1}>活泼</Text><Text tag={2}>成熟</Text><Text tag={3}>简洁</Text><Text tag={4}>土味情话</Text><Text tag={5}>连环屁</Text></Picker>
      </HStack>

    </VStack>
  )
}

async function main() {
  CustomKeyboard.requestHeight(370)
  CustomKeyboard.present(<SmartReplyKeyboard />)
}

main()
