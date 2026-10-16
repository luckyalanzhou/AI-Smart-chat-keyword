import { Navigation, NavigationStack, Form, Section, HStack, Text, TextField, SecureField, Button, Picker, modifiers, useState, useEffect, useCallback, useMemo, fetch, Script } from "scripting"
import { createServer, type Socket } from "node:net"
import type { ChatGPTCredential, ChatGPTModel } from "./chatgpt-auth.js"
import { buildAuthorizationURL, createCredentialRecord, createPKCE, createRandomValue, createUUID, parseLoopbackAuthorizationRequest, parseModelCatalog, refreshCredentialWithLatest, revokeCredential, verifyIdentityToken, withRefreshLease } from "./chatgpt-auth.js"
type Gender = "女" | "男" | "不透露"
type Mood = "开心" | "忙碌" | "疲惫" | "难过" | "生气" | "暧昧" | "相亲" | "普通"
type Profile = { gender: Gender; age: number; mood: Mood; personality: "内向" | "外向"; tone: "温柔" | "活泼" | "成熟" | "简洁" | "土味情话" | "连环屁" }
const defaultProfile: Profile = { gender: "不透露", age: 25, mood: "普通", personality: "外向", tone: "温柔" }
const moods: Mood[] = ["开心", "忙碌", "疲惫", "难过", "生气", "暧昧", "相亲", "普通"]
const tones: Profile["tone"][] = ["温柔", "活泼", "成熟", "简洁", "土味情话", "连环屁"]
type AIProvider = "OpenAI" | "DeepSeek" | "通义千问" | "智谱AI" | "月之暗面" | "Google Gemini" | "自定义兼容接口"
type AIConfig = { provider: AIProvider; endpoint: string; model: string; apiKey: string }
type AIAuthMode = "apiKey" | "chatgptPlan"
type ChatGPTAccount = { clientId: string; subject: string; email: string; scopes: string[] }
type AIProviderPreferences = Partial<Record<AIProvider, { endpoint: string; model: string }>>
const providerDefaults: Record<AIProvider, { endpoint: string; model: string }> = {
  "OpenAI": { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  "DeepSeek": { endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash" },
  "通义千问": { endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-turbo" },
  "智谱AI": { endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash" },
  "月之暗面": { endpoint: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k" },
  "Google Gemini": { endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", model: "gemini-3.8-flash" },
  "自定义兼容接口": { endpoint: "https://api.openai.com/v1/chat/completions", model: "" }
}
const defaultAI: AIConfig = { provider: "OpenAI", ...providerDefaults.OpenAI, apiKey: "" }
const normalizeAI = (config: AIConfig): AIConfig => config.provider === "DeepSeek" && ["deepseek-chat", "deepseek-reasoner"].includes(config.model)
  ? { ...config, model: "deepseek-v4-flash" }
  : config.provider === "Google Gemini" && config.model === "gemini-2.0-flash"
    ? { ...config, model: "gemini-3.8-flash" }
    : config
let modelRequestId = 0
let modelRequest: AbortController | null = null
let chatGPTModelRequestId = 0
let chatGPTModelRequest: AbortController | null = null

const CHATGPT_CREDENTIAL_KEY = "ai-smart-chat-keyword.chatgpt.credentials.v1"
const CHATGPT_REFRESH_LOCK_KEY = "ai-smart-chat-keyword.chatgpt.refresh-lock.v1"
const CHATGPT_HOST_ID_KEY = "ai-smart-chat-keyword.chatgpt.hostId"
const CHATGPT_MODEL_KEY = "ai-smart-chat-keyword.chatgpt.model"
const CHATGPT_MODE_KEY = "ai-smart-chat-keyword.chatgpt.authMode"
const CHATGPT_NOTICE_KEY = "ai-smart-chat-keyword.chatgpt.planNoticeAcknowledged"
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage"
const CHATGPT_CALLBACK_PATH = "/auth/callback"

function readChatGPTCredential(): ChatGPTCredential | null {
  try {
    const value = Keychain.get(CHATGPT_CREDENTIAL_KEY)
    if (!value) return null
    const parsed = JSON.parse(value)
    return parsed && parsed.version === 1
      && typeof parsed.clientId === "string" && parsed.clientId
      && typeof parsed.hostId === "string" && parsed.hostId
      && typeof parsed.subject === "string" && parsed.subject
      && typeof parsed.idToken === "string" && parsed.idToken
      && typeof parsed.accessToken === "string" && parsed.accessToken
      && typeof parsed.refreshToken === "string" && parsed.refreshToken
      && Array.isArray(parsed.scopes) && Number.isFinite(parsed.expiresAt)
      ? parsed as ChatGPTCredential : null
  } catch { return null }
}

function saveChatGPTCredential(credential: ChatGPTCredential) {
  if (!Keychain.set(CHATGPT_CREDENTIAL_KEY, JSON.stringify(credential))) throw new Error("无法将 ChatGPT 授权安全保存到系统钥匙串")
}

type ChatGPTRefreshLease = { owner: string; expiresAt: number }
function readChatGPTRefreshLease(key: string): ChatGPTRefreshLease | null {
  try {
    const value = Keychain.get(key)
    const parsed = value ? JSON.parse(value) : null
    return parsed && typeof parsed.owner === "string" && Number.isFinite(parsed.expiresAt) ? parsed as ChatGPTRefreshLease : null
  } catch { return null }
}
function writeChatGPTRefreshLease(key: string, lease: ChatGPTRefreshLease | null) {
  return lease ? Keychain.set(key, JSON.stringify(lease)) : Keychain.remove(key)
}
function withChatGPTRefreshLease<T>(credential: ChatGPTCredential, operation: () => Promise<T>) {
  const key = `${CHATGPT_REFRESH_LOCK_KEY}.${credential.clientId}`
  return withRefreshLease(
    createRandomValue(crypto, 16),
    () => readChatGPTRefreshLease(key),
    (lease) => writeChatGPTRefreshLease(key, lease),
    operation,
  )
}

function readChatGPTAccount(): ChatGPTAccount | null {
  const credential = readChatGPTCredential()
  return credential ? { clientId: credential.clientId, subject: credential.subject, email: credential.email, scopes: credential.scopes } : null
}

function authPage(message: string) {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>智能聊天键盘</title><main style="font:17px -apple-system;padding:32px;text-align:center">${message}<p>现在可以返回智能聊天键盘。</p></main>`
}

function respondToAuthorizationSocket(socket: Socket, statusCode: number, message: string) {
  const body = authPage(message)
  const byteLength = new TextEncoder().encode(body).length
  const reason = statusCode === 200 ? "OK" : statusCode === 404 ? "Not Found" : "Bad Request"
  socket.end(`HTTP/1.1 ${statusCode} ${reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${byteLength}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${body}`)
}

async function receiveAuthorizationCode(clientId: string, hostId: string, idTokenHint: string, loginHint: string) {
  const pkce = await createPKCE(crypto)
  const state = createRandomValue(crypto)
  const nonce = createRandomValue(crypto)
  const peers = new Set<Socket>()
  let settle: ((value: { code: string; clientId: string }) => void) | null = null
  let fail: ((error: Error) => void) | null = null
  let settled = false
  let isListening = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => { settle = resolve; fail = reject })
  void callback.catch(() => {})
  const server = createServer({ allowHalfOpen: false }, (socket) => {
    peers.add(socket)
    socket.on("close", () => peers.delete(socket))
    socket.on("error", () => peers.delete(socket))
    socket.setTimeout(15_000, () => socket.destroy())
    let requestData = ""
    let handled = false
    socket.on("data", (data) => {
      if (handled) return
      requestData += data.toString()
      if (requestData.length > 16_384) {
        handled = true
        respondToAuthorizationSocket(socket, 400, "授权回调请求过长。")
        return
      }
      const headerEnd = requestData.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      handled = true
      const requestLine = requestData.slice(0, requestData.indexOf("\r\n"))
      let query: Record<string, string>
      try {
        const address = socket.remoteAddress || null
        const addressInfo = server.address()
        if (!addressInfo || typeof addressInfo === "string") throw new Error("本地授权回调没有监听端口")
        query = parseLoopbackAuthorizationRequest(requestLine, address, addressInfo.port)
      } catch {
        respondToAuthorizationSocket(socket, 400, "授权回调无效，请返回应用后重试。")
        return
      }
      if (query.state !== state) {
        respondToAuthorizationSocket(socket, 400, "授权响应无法验证，请返回应用后重试。")
        return
      }
      if (settled) {
        respondToAuthorizationSocket(socket, 400, "此授权请求已结束。")
        return
      }
      if (query.error) {
        settled = true
        fail?.(new Error(query.error === "access_denied" ? "你取消了 ChatGPT 授权" : "ChatGPT 授权未能完成"))
        respondToAuthorizationSocket(socket, 200, "授权未完成。")
        return
      }
      const returnedClientId = query.client_id || ""
      if (clientId === "dynamic_agent_client" && (!returnedClientId || returnedClientId === "dynamic_agent_client")) {
        settled = true
        fail?.(new Error("ChatGPT 没有返回新注册的客户端标识，请重新开始登录"))
        respondToAuthorizationSocket(socket, 200, "授权信息不完整。")
        return
      }
      if (clientId !== "dynamic_agent_client" && returnedClientId && returnedClientId !== clientId) {
        settled = true
        fail?.(new Error("ChatGPT 返回的账号注册与当前选择不一致"))
        respondToAuthorizationSocket(socket, 200, "授权账号与当前选择不一致。")
        return
      }
      if (!query.code) {
        settled = true
        fail?.(new Error("ChatGPT 回调没有包含授权码"))
        respondToAuthorizationSocket(socket, 200, "授权信息不完整。")
        return
      }
      settled = true
      settle?.({ code: query.code, clientId: clientId === "dynamic_agent_client" ? returnedClientId : clientId })
      respondToAuthorizationSocket(socket, 200, "ChatGPT 授权已返回。")
    })
  })
  server.on("error", (error: Error) => {
    if (isListening && !settled) {
      settled = true
      fail?.(new Error(`本地授权回调失败：${error.message}`))
    }
  })

  try {
    const port = await new Promise<number>((resolve, reject) => {
      const onListenError = (error: Error) => reject(error)
      server.once("error", onListenError)
      server.listen({ port: 0, host: "127.0.0.1" }, () => {
        server.removeListener("error", onListenError)
        isListening = true
        const address = server.address()
        if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
          reject(new Error("本地授权回调未绑定到 127.0.0.1"))
          return
        }
        resolve(address.port)
      })
    })
    const redirectUri = `http://127.0.0.1:${port}${CHATGPT_CALLBACK_PATH}`
    const authorizationURL = buildAuthorizationURL({
      clientId,
      hostId,
      agentName: "智能聊天键盘",
      redirectUri,
      state,
      nonce,
      codeChallenge: pkce.challenge,
      idTokenHint: idTokenHint || undefined,
      loginHint: loginHint || undefined,
    })
    timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        fail?.(new Error("等待 ChatGPT 授权超时；请返回设置后重试"))
      }
    }, 180_000)
    const opened = await Safari.openURL(authorizationURL)
    if (!opened) throw new Error("无法打开系统浏览器进行 ChatGPT 授权")
    const result = await callback
    return { ...result, redirectUri, verifier: pkce.verifier, nonce }
  } finally {
    if (timeout) clearTimeout(timeout)
    for (const peer of peers) peer.destroy()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function completeChatGPTSignIn() {
  const account = readChatGPTAccount()
  let credential = readChatGPTCredential()
  const savedHostId = Storage.get<string>(CHATGPT_HOST_ID_KEY, { shared: true })
  const hostId = savedHostId || `urn:uuid:${createUUID(crypto)}`
  if (!savedHostId) Storage.set(CHATGPT_HOST_ID_KEY, hostId, { shared: true })
  const requestedClientId = account?.clientId || "dynamic_agent_client"
  const authorization = await receiveAuthorizationCode(requestedClientId, hostId, credential?.idToken || "", account?.email || "")
  const tokenResponse = await fetch("https://auth.openai.com/api/accounts/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorization.code,
      redirect_uri: authorization.redirectUri,
      client_id: authorization.clientId,
      code_verifier: authorization.verifier,
      resource: "https://api.openai.com/v1",
    }).toString(),
    timeout: 25,
  })
  let tokenData: any = {}
  try { tokenData = await tokenResponse.json() } catch { /* Use a safe status-only error below. */ }
  if (!tokenResponse.ok) {
    const code = tokenData?.error?.code || tokenData?.error || tokenData?.code
    throw new Error(`ChatGPT 授权交换失败（HTTP ${tokenResponse.status}${code ? `，${String(code).slice(0, 60)}` : ""}）`)
  }
  if (typeof tokenData.id_token !== "string") throw new Error("ChatGPT 没有返回身份令牌，未保存任何授权信息")
  const identity = await verifyIdentityToken(tokenData.id_token, authorization.nonce, authorization.clientId, fetch, crypto.subtle)
  if (account?.clientId === authorization.clientId && account.subject && identity.sub !== account.subject) throw new Error("此次登录的 ChatGPT 身份与已保存账号不一致；原有登录状态未更改")
  credential = createCredentialRecord(tokenData, identity, authorization.clientId, hostId)
  saveChatGPTCredential(credential)
  const nextAccount: ChatGPTAccount = {
    clientId: credential.clientId,
    subject: credential.subject,
    email: credential.email,
    scopes: credential.scopes,
  }
  Storage.set(CHATGPT_MODE_KEY, "chatgptPlan", { shared: true })
  return nextAccount
}

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
  const storedAuthMode = Storage.get<AIAuthMode>(CHATGPT_MODE_KEY, { shared: true })
  const [ai, setAI] = useState<AIConfig>(initialAI)
  const [authMode, setAuthMode] = useState<AIAuthMode>(storedAuthMode === "chatgptPlan" ? "chatgptPlan" : "apiKey")
  const [chatGPTAccount, setChatGPTAccount] = useState<ChatGPTAccount | null>(readChatGPTAccount())
  const [chatGPTModels, setChatGPTModels] = useState<ChatGPTModel[]>([])
  const [selectedChatGPTModel, setSelectedChatGPTModel] = useState<string>(Storage.get<string>(CHATGPT_MODEL_KEY, { shared: true }) || "")
  const [chatGPTNotice, setChatGPTNotice] = useState("登录 ChatGPT 后读取该账号可用模型")
  const [chatGPTBusy, setChatGPTBusy] = useState(false)
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
    const providerPreferences = Storage.get<AIProviderPreferences>("aiProviderPreferences", { shared: true }) || {}
    providerPreferences[next.provider] = { endpoint: next.endpoint, model: next.model }
    Storage.set("aiProviderPreferences", providerPreferences, { shared: true })
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
    const providerPreferences = Storage.get<AIProviderPreferences>("aiProviderPreferences", { shared: true }) || {}
    storedKeys[ai.provider] = ai.apiKey
    providerPreferences[ai.provider] = { endpoint: ai.endpoint, model: ai.model }
    const next = { ...ai, provider, ...(providerPreferences[provider] || providerDefaults[provider]), apiKey: storedKeys[provider] || "" }
    storedKeys[provider] = next.apiKey
    Storage.set("aiKeys", storedKeys, { shared: true })
    Storage.set("aiProviderPreferences", providerPreferences, { shared: true })
    saveAI(next)
  }, [ai, saveAI])
  const changeAuthMode = useCallback((mode: AIAuthMode) => {
    if (mode !== "apiKey") {
      modelRequestId++
      modelRequest?.abort()
      modelRequest = null
    }
    if (mode !== "chatgptPlan") {
      chatGPTModelRequestId++
      chatGPTModelRequest?.abort()
      chatGPTModelRequest = null
    }
    setAuthMode(mode)
    Storage.set(CHATGPT_MODE_KEY, mode, { shared: true })
    if (mode === "chatgptPlan" && !readChatGPTCredential()) setChatGPTNotice("请先使用 ChatGPT 账号授权")
  }, [])
  const refreshChatGPTModels = useCallback(async () => {
    const requestId = ++chatGPTModelRequestId
    chatGPTModelRequest?.abort()
    const controller = new AbortController()
    chatGPTModelRequest = controller
    let credential = readChatGPTCredential()
    if (!credential) { setChatGPTModels([]); setChatGPTNotice("请先使用 ChatGPT 账号授权"); return }
    if (!credential.scopes?.includes("chatgpt.tokens.use.direct")) { setChatGPTModels([]); setChatGPTNotice("当前授权未允许使用 ChatGPT 计划，请重新登录授权"); return }
    setChatGPTNotice("正在读取该账号可用模型…")
    try {
      credential = await refreshCredentialWithLatest(credential, fetch, readChatGPTCredential, saveChatGPTCredential, Date.now(), (operation) => withChatGPTRefreshLease(credential!, operation))
      const response = await fetch("https://api.openai.com/v1/models", {
        signal: controller.signal,
        timeout: 20,
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      })
      let payload: any = {}
      try { payload = await response.json() } catch { /* Use a safe HTTP status below. */ }
      if (!response.ok) throw new Error(payload?.error?.message || payload?.detail || `HTTP ${response.status}`)
      const values = parseModelCatalog(payload)
      if (!values.length) throw new Error("该账号暂时没有可选择的模型")
      if (requestId !== chatGPTModelRequestId) return
      const currentCredential = readChatGPTCredential()
      if (!currentCredential || currentCredential.clientId !== credential.clientId || currentCredential.subject !== credential.subject) return
      setChatGPTModels(values)
      const storedModel = Storage.get<string>(CHATGPT_MODEL_KEY, { shared: true }) || ""
      const selectedModel = values.some((model) => model.slug === storedModel) ? storedModel : values[0].slug
      setSelectedChatGPTModel(selectedModel)
      if (selectedModel !== storedModel) Storage.set(CHATGPT_MODEL_KEY, selectedModel, { shared: true })
      setChatGPTNotice(`已读取 ${values.length} 个账号可用模型`)
    } catch (error) {
      if (requestId !== chatGPTModelRequestId || (error as any)?.name === "AbortError") return
      if ((error as any)?.requiresSignIn) {
        const currentCredential = readChatGPTCredential()
        if ((error as any)?.invalidCredential && currentCredential?.refreshToken === credential.refreshToken) Keychain.remove(CHATGPT_CREDENTIAL_KEY)
        setChatGPTAccount(readChatGPTAccount())
        setChatGPTModels([])
      }
      setChatGPTNotice((error as any)?.credentialChanged ? "ChatGPT 登录状态刚刚改变，请重新读取模型" : (error as any)?.requiresSignIn ? "ChatGPT 登录已失效，请重新授权" : `读取 ChatGPT 模型失败：${String(error).replace("Error: ", "")}`)
    }
  }, [])
  const loginChatGPT = useCallback(async () => {
    if (chatGPTBusy) return
    setChatGPTBusy(true)
    setChatGPTNotice("正在等待 ChatGPT 授权…")
    try {
      if (!Storage.get<boolean>(CHATGPT_NOTICE_KEY, { shared: true })) {
        await Dialog.alert({
          title: "正在使用你的 ChatGPT 计划",
          message: "只有你主动粘贴对方消息或点击生成后，对方消息、可选聊天上下文和回复风格资料才会发送给 OpenAI 处理。请求使用不保存响应的模式；授权令牌仅保存在本机钥匙串。符合条件的请求会使用你的 ChatGPT 计划或额度，与 OpenAI API 账单分开；你可随时在 ChatGPT 设置中查看或管理用量。",
          buttonLabel: "继续登录",
        })
        Storage.set(CHATGPT_NOTICE_KEY, true, { shared: true })
      }
      const account = await completeChatGPTSignIn()
      setChatGPTAccount(account)
      setAuthMode("chatgptPlan")
      setChatGPTNotice("ChatGPT 账号已连接，正在读取模型…")
    } catch (error) {
      setChatGPTNotice(String(error).replace("Error: ", ""))
    } finally {
      setChatGPTBusy(false)
    }
  }, [chatGPTBusy])
  const logoutChatGPT = useCallback(async () => {
    const confirmed = await Dialog.confirm({
      title: "退出 ChatGPT 账号",
      message: "这会尝试撤销 ChatGPT 授权，并清除此设备上保存的登录令牌。",
      cancelLabel: "取消",
      confirmLabel: "退出登录",
    })
    if (!confirmed) return
    chatGPTModelRequestId++
    chatGPTModelRequest?.abort()
    chatGPTModelRequest = null
    let remoteRevoked = false
    try {
      const credential = readChatGPTCredential()
      if (credential) remoteRevoked = await revokeCredential(credential, fetch)
    } catch { /* Local tokens are cleared even when the remote revocation cannot be confirmed. */ }
    Keychain.remove(CHATGPT_CREDENTIAL_KEY)
    setAuthMode("apiKey")
    Storage.set(CHATGPT_MODE_KEY, "apiKey", { shared: true })
    setChatGPTAccount(readChatGPTAccount())
    setChatGPTModels([])
    setChatGPTNotice(remoteRevoked ? "已退出 ChatGPT 账号" : "本机令牌已清除；远程撤销未确认，请在 ChatGPT 设置中检查连接")
    if (!remoteRevoked) await Dialog.alert({
      title: "已在本机退出",
      message: "本机令牌已清除，但无法确认远程授权已撤销。你也可以在 ChatGPT 设置中断开此应用。",
      buttonLabel: "知道了",
    })
  }, [])
  useEffect(() => {
    if (authMode !== "chatgptPlan") return
    if (!readChatGPTCredential()) { setChatGPTModels([]); setChatGPTNotice("请先使用 ChatGPT 账号授权"); return }
    const timeout = setTimeout(() => { void refreshChatGPTModels() }, 100)
    return () => { clearTimeout(timeout); chatGPTModelRequestId++; chatGPTModelRequest?.abort(); chatGPTModelRequest = null }
  }, [authMode, refreshChatGPTModels])
  const keyField = useMemo(
    () => showKey
      ? <TextField title="API Key" prompt="粘贴服务商 API Key" value={ai.apiKey} onChanged={(value) => saveAI({ ...ai, apiKey: value })} modifiers={modifiers().frame({ maxWidth: "infinity" })} />
      : <SecureField title="API Key" prompt="粘贴服务商 API Key" value={ai.apiKey} onChanged={(value) => saveAI({ ...ai, apiKey: value })} modifiers={modifiers().frame({ maxWidth: "infinity" })} />,
    [ai, saveAI, showKey],
  )
  useEffect(() => {
    if (authMode !== "apiKey") return
    const storedKeys = Storage.get<Record<AIProvider, string>>("aiKeys", { shared: true }) || {} as Record<AIProvider, string>
    if (storedKeys[ai.provider] !== ai.apiKey) {
      storedKeys[ai.provider] = ai.apiKey
      Storage.set("aiKeys", storedKeys, { shared: true })
    }
    setModels([])
    if (!ai.apiKey.trim()) {
      setModelNotice("填写 API Key 后会自动读取可用模型")
      return
    }
    setModelNotice("正在准备读取模型…")
    const timeout = setTimeout(() => { void refreshModels() }, 650)
    return () => clearTimeout(timeout)
  }, [authMode, ai.provider, ai.apiKey, ai.endpoint])

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

        <Section header={<Text>AI 服务</Text>} footer={<Text>{authMode === "apiKey" ? modelNotice : chatGPTNotice}</Text>}>
          <Picker title="接入方式" pickerStyle="menu" value={authMode} onChanged={(value: any) => changeAuthMode(value as AIAuthMode)}><Text tag="apiKey">API Key</Text><Text tag="chatgptPlan">ChatGPT 账号计划</Text></Picker>
          {authMode === "chatgptPlan" ? <>
            <Text>符合条件的 AI 回复会使用你的 ChatGPT 计划或额度，与 OpenAI API 账单分开。</Text>
            {readChatGPTCredential()
              ? <HStack>
                  <Text>{chatGPTAccount?.email || "ChatGPT 已连接"}</Text>
                  <Button title="退出登录" buttonStyle="plain" action={() => { void logoutChatGPT() }} />
                </HStack>
              : <Button title={chatGPTBusy ? "正在连接…" : "Continue with ChatGPT"} buttonStyle="borderedProminent" disabled={chatGPTBusy} action={() => { void loginChatGPT() }} />}
            <HStack>
              {chatGPTModels.length > 0
                ? <Picker title="模型" pickerStyle="menu" value={selectedChatGPTModel || chatGPTModels[0].slug} onChanged={(value: any) => { const model = value as string; setSelectedChatGPTModel(model); Storage.set(CHATGPT_MODEL_KEY, model, { shared: true }) }}>{chatGPTModels.map((model) => <Text tag={model.slug}>{model.displayName}</Text>)}</Picker>
                : <Text>登录后读取该账号可用模型</Text>}
              <Button title="刷新模型" systemImage="arrow.clockwise" action={() => { void refreshChatGPTModels() }} />
            </HStack>
            <Button title="管理 ChatGPT 用量" systemImage="arrow.up.right" action={() => { void Safari.openURL(CHATGPT_USAGE_URL) }} />
          </> : <>
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
          </>}
        </Section>

        {authMode === "apiKey" ? <Section header={<Text>高级设置</Text>}>
          <Button title={showAdvanced ? "收起接口设置" : "自定义接口地址"} systemImage={showAdvanced ? "chevron.up" : "chevron.down"} action={() => setShowAdvanced(!showAdvanced)} />
          {showAdvanced ? <TextField title="接口地址" prompt="https://…/chat/completions" value={ai.endpoint} onChanged={(v) => saveAI({ ...ai, endpoint: v })} /> : null}
        </Section> : null}
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
