"use strict"

const AUTHORIZATION_ENDPOINT = "https://auth.openai.com/api/accounts/authorize"
const TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token"
const DISCOVERY_ENDPOINT = "https://auth.openai.com/.well-known/openid-configuration"
const JWKS_ENDPOINT = "https://auth.openai.com/.well-known/jwks.json"
const RESOURCE = "https://api.openai.com/v1"
const REQUIRED_PLAN_SCOPES = ["resource.invoke", "chatgpt.tokens.use.direct"]

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let output = ""
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const hasSecond = index + 1 < bytes.length
    const hasThird = index + 2 < bytes.length
    const second = hasSecond ? bytes[index + 1] : 0
    const third = hasThird ? bytes[index + 2] : 0
    output += alphabet[first >> 2]
    output += alphabet[((first & 3) << 4) | (second >> 4)]
    if (hasSecond) output += alphabet[((second & 15) << 2) | (third >> 6)]
    if (hasThird) output += alphabet[third & 63]
  }
  return output
}

function base64UrlDecode(value) {
  const input = String(value).replace(/-/g, "+").replace(/_/g, "/")
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 === 1) throw new Error("Invalid base64url data")
  const normalized = input.replace(/=+$/, "")
  const bytes = []
  let buffer = 0
  let bitCount = 0
  for (const character of normalized) {
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error("Invalid base64url data")
    buffer = (buffer << 6) | value
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      bytes.push((buffer >> bitCount) & 255)
    }
  }
  return new Uint8Array(bytes)
}

function decodeBase64UrlJSON(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)))
}

function formBody(values) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value != null) body.append(key, String(value))
  }
  return body.toString()
}

async function createPKCE(cryptoProvider) {
  const bytes = new Uint8Array(32)
  cryptoProvider.getRandomValues(bytes)
  const verifier = base64UrlEncode(bytes)
  const digest = await cryptoProvider.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(digest) }
}

function createRandomValue(cryptoProvider, byteLength = 32) {
  const bytes = new Uint8Array(byteLength)
  cryptoProvider.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

function createUUID(cryptoProvider) {
  const bytes = new Uint8Array(16)
  cryptoProvider.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function buildAuthorizationURL(options) {
  const firstRegistration = options.clientId === "dynamic_agent_client"
  const query = new URLSearchParams({
    client_id: options.clientId,
    ext_agent_host_id: options.hostId,
    response_type: "code",
    redirect_uri: options.redirectUri,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: RESOURCE,
    state: options.state,
    nonce: options.nonce,
    code_challenge_method: "S256",
    code_challenge: options.codeChallenge,
  })
  if (firstRegistration) query.set("agent_name_hint", options.agentName)
  if (!firstRegistration && options.idTokenHint) query.set("id_token_hint", options.idTokenHint)
  if (!firstRegistration && options.loginHint) query.set("login_hint", options.loginHint)
  return `${AUTHORIZATION_ENDPOINT}?${query.toString()}`
}

function uniqueQueryMap(queryParams) {
  const values = {}
  for (const pair of queryParams || []) {
    if (Object.prototype.hasOwnProperty.call(values, pair.key)) throw new Error("授权回调包含重复参数")
    values[pair.key] = pair.value
  }
  return values
}

function parseLoopbackAuthorizationRequest(requestLine, address, port) {
  if (!isLoopbackAddress(address)) throw new Error("授权回调只能来自本机")
  const match = /^GET (\S+) HTTP\/1\.[01]$/.exec(String(requestLine || ""))
  if (!match) throw new Error("授权回调请求格式无效")
  const base = `http://127.0.0.1:${Number(port)}`
  let url
  try { url = new URL(match[1], base) }
  catch { throw new Error("授权回调地址无效") }
  if (url.origin !== base || url.pathname !== "/auth/callback") throw new Error("授权回调地址不匹配")
  return uniqueQueryMap(Array.from(url.searchParams.entries(), ([key, value]) => ({ key, value })))
}

function isLoopbackAddress(address) {
  if (typeof address !== "string") return false
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized
  const parts = ipv4.split(".")
  const octets = parts.map(Number)
  return parts.length === 4
    && parts.every((part, index) => /^\d{1,3}$/.test(part) && octets[index] >= 0 && octets[index] <= 255)
    && octets[0] === 127
}

function parseModelCatalog(payload) {
  if (!Array.isArray(payload && payload.models)) return []
  const seen = new Set()
  return payload.models.filter((model) => {
    if (!model || model.visibility !== "list" || typeof model.slug !== "string" || !model.slug.trim()) return false
    if (seen.has(model.slug)) return false
    seen.add(model.slug)
    return true
  }).map((model) => ({
    slug: model.slug,
    displayName: typeof model.display_name === "string" && model.display_name.trim() ? model.display_name : model.slug,
  }))
}

function parseSSEBlock(block) {
  let event = "message"
  const data = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue
    const separator = line.indexOf(":")
    const field = separator < 0 ? line : line.slice(0, separator)
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "")
    if (field === "event") event = value
    else if (field === "data") data.push(value)
  }
  return { event, data: data.join("\n") }
}

function splitSSEEvents(buffer) {
  const blocks = String(buffer).split(/\r?\n\r?\n/)
  const remainder = blocks.pop() || ""
  return { events: blocks.map(parseSSEBlock).filter((item) => item.data), remainder }
}

function extractResponsesText(response) {
  const output = []
  for (const item of (response && Array.isArray(response.output) ? response.output : [])) {
    for (const content of (item && Array.isArray(item.content) ? item.content : [])) {
      if (content && content.type === "output_text" && typeof content.text === "string") output.push(content.text)
    }
  }
  return output.join("")
}

function scopesFrom(value, fallback = []) {
  if (Array.isArray(value)) return value.filter((scope) => typeof scope === "string")
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean)
  return fallback.slice()
}

function hasPlanScopes(scopes) {
  return REQUIRED_PLAN_SCOPES.every((required) => scopes.includes(required))
}

async function verifyIdentityToken(idToken, expectedNonce, clientId, fetcher, subtle, nowMs = Date.now()) {
  const parts = String(idToken || "").split(".")
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("ChatGPT 返回的身份令牌格式无效")
  const header = decodeBase64UrlJSON(parts[0])
  const claims = decodeBase64UrlJSON(parts[1])
  const algorithm = header.alg
  if (algorithm !== "RS256" && algorithm !== "ES256") throw new Error("ChatGPT 身份令牌使用了不支持的签名算法")
  if (typeof header.kid !== "string" || !header.kid) throw new Error("ChatGPT 身份令牌缺少签名密钥标识")

  const jwksResponse = await fetcher(JWKS_ENDPOINT, { timeout: 15 })
  if (!jwksResponse.ok) throw new Error("无法验证 ChatGPT 身份令牌的签名密钥")
  const jwks = await jwksResponse.json()
  const jwk = Array.isArray(jwks && jwks.keys) ? jwks.keys.find((key) => key && key.kid === header.kid && (!key.use || key.use === "sig") && (!key.alg || key.alg === algorithm)) : null
  if (!jwk) throw new Error("找不到 ChatGPT 身份令牌对应的签名密钥")

  let importAlgorithm
  let verifyAlgorithm
  if (algorithm === "RS256" && jwk.kty === "RSA") {
    importAlgorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
    verifyAlgorithm = { name: "RSASSA-PKCS1-v1_5" }
  } else if (algorithm === "ES256" && jwk.kty === "EC" && jwk.crv === "P-256") {
    importAlgorithm = { name: "ECDSA", namedCurve: "P-256" }
    verifyAlgorithm = { name: "ECDSA", hash: "SHA-256" }
  } else {
    throw new Error("ChatGPT 身份令牌的签名密钥类型不匹配")
  }
  const publicKey = await subtle.importKey("jwk", jwk, importAlgorithm, false, ["verify"])
  const signatureValid = await subtle.verify(verifyAlgorithm, publicKey, base64UrlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!signatureValid) throw new Error("ChatGPT 身份令牌签名无效")

  const nowSeconds = Math.floor(nowMs / 1000)
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const audienceValid = audiences.includes(clientId)
    && (!claims.azp || claims.azp === clientId)
    && (audiences.length <= 1 || claims.azp === clientId)
  if (claims.iss !== "https://auth.openai.com" || !audienceValid) throw new Error("ChatGPT 身份令牌的签发者或客户端不匹配")
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number" || claims.exp <= nowSeconds - 30) throw new Error("ChatGPT 身份令牌已过期或缺少账号标识")
  if (typeof claims.iat !== "number" || claims.iat > nowSeconds + 300 || (typeof claims.nbf === "number" && claims.nbf > nowSeconds + 30)) throw new Error("ChatGPT 身份令牌尚未生效")
  if (claims.nonce !== expectedNonce) throw new Error("ChatGPT 身份令牌的 nonce 不匹配")
  return claims
}

function createCredentialRecord(tokenResponse, identity, clientId, hostId, nowMs = Date.now()) {
  const scopes = scopesFrom(tokenResponse && tokenResponse.scope)
  if (!hasPlanScopes(scopes)) throw new Error("授权未包含 ChatGPT 计划请求所需权限；请重新登录并同意计划用量授权")
  if (!tokenResponse || tokenResponse.token_type && String(tokenResponse.token_type).toLowerCase() !== "bearer") throw new Error("ChatGPT 返回了不支持的令牌类型")
  if (typeof tokenResponse.id_token !== "string" || !tokenResponse.id_token) throw new Error("ChatGPT 没有返回可验证的身份令牌")
  if (typeof tokenResponse.access_token !== "string" || !tokenResponse.access_token || typeof tokenResponse.refresh_token !== "string" || !tokenResponse.refresh_token) throw new Error("ChatGPT 没有返回可续期的授权凭据")
  const expiresIn = Number(tokenResponse.expires_in)
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("ChatGPT 返回的令牌有效期无效")
  return {
    version: 1,
    clientId,
    hostId,
    subject: identity.sub,
    email: typeof identity.email === "string" ? identity.email : "",
    idToken: tokenResponse.id_token,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    scopes,
    expiresAt: nowMs + expiresIn * 1000,
  }
}

function isTerminalRefreshError(code) {
  return ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].includes(code)
}

async function refreshCredential(credential, fetcher, nowMs = Date.now()) {
  if (!credential || !credential.accessToken || !credential.refreshToken || !credential.clientId) {
    const error = new Error("ChatGPT 登录状态不完整，请重新登录")
    error.requiresSignIn = true
    throw error
  }
  if (credential.expiresAt > nowMs + 90_000) return credential

  const response = await fetcher(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody({ grant_type: "refresh_token", client_id: credential.clientId, refresh_token: credential.refreshToken, resource: RESOURCE }),
    timeout: 20,
  })
  let payload = {}
  try { payload = await response.json() } catch { /* The error below intentionally does not include credential material. */ }
  if (!response.ok) {
    const code = payload && payload.error && (payload.error.code || payload.error) || payload && payload.code || ""
    const error = new Error(isTerminalRefreshError(code) ? "ChatGPT 登录已失效，请重新登录" : `ChatGPT 令牌续期失败（HTTP ${response.status}）`)
    error.code = code
    error.status = response.status
    error.requiresSignIn = isTerminalRefreshError(code)
    throw error
  }
  const scopes = scopesFrom(payload.scope, credential.scopes)
  if (!hasPlanScopes(scopes) || typeof payload.access_token !== "string" || !payload.access_token || typeof payload.refresh_token !== "string" || !payload.refresh_token) {
    const error = new Error("ChatGPT 续期响应不完整，请重新登录")
    error.requiresSignIn = true
    throw error
  }
  const expiresIn = Number(payload.expires_in)
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("ChatGPT 返回的续期时间无效")
  return { ...credential, accessToken: payload.access_token, refreshToken: payload.refresh_token, scopes, expiresAt: nowMs + expiresIn * 1000 }
}

async function withRefreshLease(owner, readLease, writeLease, operation, timeoutMs = 30_000, leaseMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = readLease()
    if (!current || current.expiresAt <= Date.now()) {
      const lease = { owner, expiresAt: Date.now() + leaseMs }
      if (!writeLease(lease)) throw new Error("无法安全协调 ChatGPT 令牌续期")
      await new Promise((resolve) => setTimeout(resolve, 40))
      const confirmed = readLease()
      if (confirmed && confirmed.owner === owner) {
        try { return await operation() }
        finally {
          const latest = readLease()
          if (latest && latest.owner === owner) writeLease(null)
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 70))
  }
  throw new Error("另一个界面正在续期 ChatGPT 登录状态；等待超时，请重试")
}

async function refreshCredentialWithLatest(credential, fetcher, readLatest, saveLatest, nowMs = Date.now(), runExclusive) {
  const sameSession = (latest) => latest
    && latest.clientId === credential.clientId
    && latest.subject === credential.subject
    && latest.hostId === credential.hostId
  const changedError = () => Object.assign(new Error("ChatGPT 登录状态已更改，请重试"), { requiresSignIn: true, credentialChanged: true })
  const operation = async () => {
    const activeCredential = readLatest()
    if (!sameSession(activeCredential)) throw changedError()
    try {
      const refreshed = await refreshCredential(activeCredential, fetcher, nowMs)
      const latest = readLatest()
      if (!sameSession(latest)) throw changedError()
      if (latest.refreshToken !== activeCredential.refreshToken) return latest
      if (refreshed !== activeCredential) {
        saveLatest(refreshed)
        const afterSave = readLatest()
        if (!sameSession(afterSave)) throw changedError()
        if (afterSave.refreshToken !== refreshed.refreshToken) return afterSave
      }
      return refreshed
    } catch (error) {
      if (error.credentialChanged || !error.requiresSignIn) throw error
      let latest = readLatest()
      if (sameSession(latest) && latest.refreshToken !== activeCredential.refreshToken && latest.expiresAt > nowMs + 90_000) return latest
      await new Promise((resolve) => setTimeout(resolve, 120))
      latest = readLatest()
      if (sameSession(latest) && latest.refreshToken !== activeCredential.refreshToken && latest.expiresAt > nowMs + 90_000) return latest
      error.invalidCredential = Boolean(sameSession(latest) && latest.refreshToken === activeCredential.refreshToken)
      throw error
    }
  }
  return runExclusive ? runExclusive(operation) : operation()
}

async function revokeCredential(credential, fetcher) {
  if (!credential || !credential.refreshToken || !credential.clientId) return false
  const discoveryResponse = await fetcher(DISCOVERY_ENDPOINT, { timeout: 15 })
  if (!discoveryResponse.ok) throw new Error("无法读取 ChatGPT 会话撤销地址")
  const discovery = await discoveryResponse.json()
  const endpoint = typeof discovery.revocation_endpoint === "string" ? new URL(discovery.revocation_endpoint) : null
  if (!endpoint || endpoint.protocol !== "https:" || endpoint.origin !== "https://auth.openai.com") throw new Error("ChatGPT 会话撤销地址无效")
  const response = await fetcher(endpoint.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: formBody({ token: credential.refreshToken, token_type_hint: "refresh_token", client_id: credential.clientId }),
    timeout: 20,
  })
  if (!response.ok) throw new Error(`ChatGPT 会话撤销失败（HTTP ${response.status}）`)
  return true
}

module.exports = {
  AUTHORIZATION_ENDPOINT,
  TOKEN_ENDPOINT,
  RESOURCE,
  base64UrlEncode,
  base64UrlDecode,
  createPKCE,
  createRandomValue,
  createUUID,
  buildAuthorizationURL,
  uniqueQueryMap,
  parseLoopbackAuthorizationRequest,
  isLoopbackAddress,
  parseModelCatalog,
  parseSSEBlock,
  splitSSEEvents,
  extractResponsesText,
  scopesFrom,
  hasPlanScopes,
  verifyIdentityToken,
  createCredentialRecord,
  refreshCredential,
  withRefreshLease,
  refreshCredentialWithLatest,
  revokeCredential,
}
