// Run from the project root with:
// node -e "require.extensions['.tsx'] = require.extensions['.js']; require('./chatgpt-auth.test.tsx')"
// Plain JavaScript syntax keeps this test runnable in the Node runtime bundled with Codex.

const assert = require("node:assert/strict")
const { webcrypto } = require("node:crypto")
const auth = require("./chatgpt-auth.js")

async function run() {
  const pkce = await auth.createPKCE(webcrypto)
  assert.equal(pkce.verifier.length, 43)
  assert.equal(pkce.challenge.length, 43)
  assert.doesNotMatch(pkce.challenge, /=/)
  assert.notEqual(pkce.verifier, pkce.challenge)
  console.log("PASS PKCE verifier and S256 challenge are generated with URL-safe encoding")

  const authURL = new URL(auth.buildAuthorizationURL({
    clientId: "dynamic_agent_client",
    hostId: "urn:uuid:12345678-1234-4234-8234-123456789abc",
    agentName: "智能聊天键盘",
    redirectUri: "http://127.0.0.1:43210/auth/callback",
    state: "state-value",
    nonce: "nonce-value",
    codeChallenge: pkce.challenge,
  }))
  assert.equal(authURL.searchParams.get("client_id"), "dynamic_agent_client")
  assert.equal(authURL.searchParams.get("agent_name_hint"), "智能聊天键盘")
  assert.equal(authURL.searchParams.get("ext_agent_host_id"), "urn:uuid:12345678-1234-4234-8234-123456789abc")
  assert.equal(authURL.searchParams.get("redirect_uri"), "http://127.0.0.1:43210/auth/callback")
  assert.ok(authURL.searchParams.get("scope").includes("chatgpt.tokens.use.direct"))
  const returningURL = new URL(auth.buildAuthorizationURL({
    clientId: "oaiapp_existing",
    hostId: "urn:uuid:host",
    agentName: "智能聊天键盘",
    redirectUri: "http://127.0.0.1:43210/auth/callback",
    state: "state-value",
    nonce: "nonce-value",
    codeChallenge: pkce.challenge,
    idTokenHint: "retained-id-token",
    loginHint: "user@example.com",
  }))
  assert.equal(returningURL.searchParams.get("id_token_hint"), "retained-id-token")
  assert.equal(returningURL.searchParams.has("agent_name_hint"), false)
  console.log("PASS first registration and returning authorization use the correct OAuth parameters")

  assert.throws(() => auth.uniqueQueryMap([{ key: "state", value: "a" }, { key: "state", value: "b" }]), /重复参数/)
  assert.deepEqual(auth.uniqueQueryMap([{ key: "state", value: "a" }, { key: "code", value: "b" }]), { state: "a", code: "b" })
  assert.equal(auth.isLoopbackAddress("127.0.0.1"), true)
  assert.equal(auth.isLoopbackAddress("::1"), true)
  assert.equal(auth.isLoopbackAddress("::ffff:127.0.0.1"), true)
  assert.equal(auth.isLoopbackAddress("192.168.1.10"), false)
  assert.equal(auth.isLoopbackAddress("127.999.0.1"), false)
  assert.equal(auth.isLoopbackAddress(null), false)
  assert.deepEqual(auth.parseLoopbackAuthorizationRequest("GET /auth/callback?code=abc&state=xyz HTTP/1.1", "127.0.0.1", 43210), { code: "abc", state: "xyz" })
  assert.throws(() => auth.parseLoopbackAuthorizationRequest("GET /auth/callback?state=xyz HTTP/1.1", "192.168.1.10", 43210), /本机/)
  assert.throws(() => auth.parseLoopbackAuthorizationRequest("POST /auth/callback?state=xyz HTTP/1.1", "127.0.0.1", 43210), /请求格式/)
  assert.throws(() => auth.parseLoopbackAuthorizationRequest("GET /auth/callback?state=a&state=b HTTP/1.1", "127.0.0.1", 43210), /重复参数/)
  assert.throws(() => auth.parseLoopbackAuthorizationRequest("GET http://example.com/auth/callback?state=xyz HTTP/1.1", "127.0.0.1", 43210), /地址不匹配/)
  console.log("PASS callback parsing rejects duplicate parameters and non-loopback peers")

  let lease = null
  let activeLeaseCount = 0
  let maximumLeaseCount = 0
  const runLeased = (owner) => auth.withRefreshLease(owner, () => lease, (next) => { lease = next; return true }, async () => {
    activeLeaseCount += 1
    maximumLeaseCount = Math.max(maximumLeaseCount, activeLeaseCount)
    await new Promise((resolve) => setTimeout(resolve, 45))
    activeLeaseCount -= 1
    return owner
  }, 1000, 1000)
  const leaseResults = await Promise.all([runLeased("first"), runLeased("second")])
  assert.deepEqual(leaseResults.sort(), ["first", "second"])
  assert.equal(maximumLeaseCount, 1)
  assert.equal(lease, null)
  console.log("PASS shared refresh lease serializes simultaneous refresh operations")

  assert.deepEqual(auth.parseModelCatalog({ models: [
    { slug: "gpt-a", display_name: "Model A", visibility: "list" },
    { slug: "gpt-hidden", display_name: "Hidden", visibility: "private" },
    { slug: "gpt-a", display_name: "Duplicate", visibility: "list" },
    { slug: "", display_name: "Invalid", visibility: "list" },
  ] }), [{ slug: "gpt-a", displayName: "Model A" }])
  assert.equal(auth.hasPlanScopes(["resource.invoke", "chatgpt.tokens.use.direct"]), true)
  assert.equal(auth.hasPlanScopes(["openid", "resource.invoke"]), false)
  console.log("PASS model catalog only exposes listed account models and plan scope is required")

  const firstChunk = auth.splitSSEEvents('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"你好"}\r')
  assert.equal(firstChunk.events.length, 0)
  const secondChunk = auth.splitSSEEvents(`${firstChunk.remainder}\n\r\nevent: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}\n\n`)
  assert.equal(secondChunk.events.length, 2)
  assert.equal(secondChunk.events[0].event, "response.output_text.delta")
  assert.equal(JSON.parse(secondChunk.events[0].data).delta, "你好")
  assert.equal(secondChunk.events[1].event, "response.completed")
  assert.equal(auth.extractResponsesText({ output: [{ content: [{ type: "output_text", text: "回复" }] }] }), "回复")
  console.log("PASS SSE event parsing preserves split UTF-8 payload boundaries and extracts completed text")

  const keyPair = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["sign", "verify"])
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey)
  publicJwk.kid = "test-key"
  publicJwk.alg = "RS256"
  publicJwk.use = "sig"
  const now = 1_800_000_000_000
  const header = auth.base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test-key" })))
  const validClaims = {
    iss: "https://auth.openai.com",
    aud: "oaiapp_test",
    sub: "account-subject",
    email: "user@example.com",
    exp: Math.floor(now / 1000) + 3600,
    iat: Math.floor(now / 1000),
    nonce: "expected-nonce",
  }
  const makeToken = async (claims) => {
    const payload = auth.base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)))
    const signingInput = `${header}.${payload}`
    const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signingInput))
    return `${signingInput}.${auth.base64UrlEncode(signature)}`
  }
  const token = await makeToken(validClaims)
  const jwksFetcher = async () => ({ ok: true, json: async () => ({ keys: [publicJwk] }) })
  const identity = await auth.verifyIdentityToken(token, "expected-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now)
  assert.equal(identity.sub, "account-subject")
  assert.equal(identity.email, "user@example.com")
  await assert.rejects(auth.verifyIdentityToken(token, "wrong-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now), /nonce/)
  await assert.rejects(auth.verifyIdentityToken(await makeToken({ ...validClaims, iss: "https://evil.example" }), "expected-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now), /签发者/)
  await assert.rejects(auth.verifyIdentityToken(await makeToken({ ...validClaims, aud: "another-client" }), "expected-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now), /签发者/)
  await assert.rejects(auth.verifyIdentityToken(await makeToken({ ...validClaims, aud: ["oaiapp_test", "another-client"] }), "expected-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now), /签发者/)
  assert.equal((await auth.verifyIdentityToken(await makeToken({ ...validClaims, aud: ["oaiapp_test", "another-client"], azp: "oaiapp_test" }), "expected-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now)).sub, "account-subject")
  await assert.rejects(auth.verifyIdentityToken(await makeToken({ ...validClaims, exp: Math.floor(now / 1000) - 600 }), "expected-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now), /过期/)
  const tamperedSignature = auth.base64UrlDecode(token.split(".")[2])
  tamperedSignature[0] ^= 1
  const tamperedToken = `${token.split(".").slice(0, 2).join(".")}.${auth.base64UrlEncode(tamperedSignature)}`
  await assert.rejects(auth.verifyIdentityToken(tamperedToken, "expected-nonce", "oaiapp_test", jwksFetcher, webcrypto.subtle, now), /签名无效/)
  console.log("PASS ID token validation verifies JWKS signature, issuer, audience, expiry and nonce")

  const credential = auth.createCredentialRecord({
    id_token: token,
    access_token: "access-old",
    refresh_token: "refresh-old",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid resource.invoke chatgpt.tokens.use.direct",
  }, identity, "oaiapp_test", "urn:uuid:host", now)
  const requests = []
  const rotated = await auth.refreshCredential({ ...credential, expiresAt: now }, async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => ({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 }) }
  }, now)
  assert.equal(rotated.accessToken, "access-new")
  assert.equal(rotated.refreshToken, "refresh-new")
  assert.match(requests[0].options.body, /client_id=oaiapp_test/)
  assert.match(requests[0].options.body, /resource=https%3A%2F%2Fapi.openai.com%2Fv1/)
  await assert.rejects(auth.refreshCredential({ ...credential, expiresAt: now }, async () => ({ ok: false, status: 400, json: async () => ({ error: { code: "invalid_grant" } }) }), now), (error) => error.requiresSignIn === true)
  let storedCredential = { ...credential, expiresAt: now }
  const safeRotation = await auth.refreshCredentialWithLatest(storedCredential, async () => ({ ok: true, json: async () => ({ access_token: "access-safe", refresh_token: "refresh-safe", expires_in: 3600 }) }), () => storedCredential, (value) => { storedCredential = value }, now)
  assert.equal(safeRotation.refreshToken, "refresh-safe")
  assert.equal(storedCredential.refreshToken, "refresh-safe")
  storedCredential = { ...credential, expiresAt: now }
  const racedCredential = { ...credential, refreshToken: "refresh-concurrent", accessToken: "access-concurrent", expiresAt: now + 3_600_000 }
  const concurrentResult = await auth.refreshCredentialWithLatest({ ...credential, expiresAt: now }, async () => {
    storedCredential = racedCredential
    return { ok: false, status: 400, json: async () => ({ error: { code: "invalid_grant" } }) }
  }, () => storedCredential, () => assert.fail("must not overwrite the concurrent refresh"), now)
  assert.equal(concurrentResult.refreshToken, "refresh-concurrent")
  const trulyRevoked = await auth.refreshCredentialWithLatest({ ...credential, expiresAt: now }, async () => ({ ok: false, status: 400, json: async () => ({ error: { code: "invalid_grant" } }) }), () => ({ ...credential, expiresAt: now }), () => assert.fail("must not save a revoked refresh token"), now).then(() => null, (error) => error)
  assert.equal(trulyRevoked.invalidCredential, true)
  console.log("PASS refresh rotation replaces access and refresh tokens and flags terminal revocation")

  const revocationCalls = []
  const revoked = await auth.revokeCredential(credential, async (url, options) => {
    revocationCalls.push({ url, options })
    return revocationCalls.length === 1
      ? { ok: true, json: async () => ({ revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" }) }
      : { ok: true, status: 200 }
  })
  assert.equal(revoked, true)
  assert.equal(revocationCalls[1].url, "https://auth.openai.com/api/accounts/oauth/revoke")
  assert.match(revocationCalls[1].options.body, /token_type_hint=refresh_token/)
  assert.match(revocationCalls[1].options.body, /client_id=oaiapp_test/)
  console.log("PASS sign-out revokes only the selected renewable session through OpenID discovery")
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
