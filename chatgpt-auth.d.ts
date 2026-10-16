export interface ChatGPTModel {
  slug: string
  displayName: string
}

export interface ChatGPTCredential {
  version: number
  clientId: string
  hostId: string
  subject: string
  email: string
  idToken: string
  accessToken: string
  refreshToken: string
  scopes: string[]
  expiresAt: number
}

export function base64UrlEncode(value: ArrayBuffer | Uint8Array): string
export function base64UrlDecode(value: string): Uint8Array
export function createPKCE(cryptoProvider: Crypto): Promise<{ verifier: string; challenge: string }>
export function createRandomValue(cryptoProvider: Crypto, byteLength?: number): string
export function createUUID(cryptoProvider: Crypto): string
export function buildAuthorizationURL(options: { clientId: string; hostId: string; agentName: string; redirectUri: string; state: string; nonce: string; codeChallenge: string; idTokenHint?: string; loginHint?: string }): string
export function uniqueQueryMap(queryParams: Array<{ key: string; value: string }>): Record<string, string>
export function parseLoopbackAuthorizationRequest(requestLine: string, address: string | null, port: number): Record<string, string>
export function isLoopbackAddress(address: string | null): boolean
export function parseModelCatalog(payload: unknown): ChatGPTModel[]
export function parseSSEBlock(block: string): { event: string; data: string }
export function splitSSEEvents(buffer: string): { events: Array<{ event: string; data: string }>; remainder: string }
export function extractResponsesText(response: unknown): string
export function scopesFrom(value: unknown, fallback?: string[]): string[]
export function hasPlanScopes(scopes: string[]): boolean
export function verifyIdentityToken(idToken: string, expectedNonce: string, clientId: string, fetcher: typeof fetch, subtle: SubtleCrypto, nowMs?: number): Promise<Record<string, unknown> & { sub: string; email?: string }>
export function createCredentialRecord(tokenResponse: Record<string, unknown>, identity: { sub: string; email?: string }, clientId: string, hostId: string, nowMs?: number): ChatGPTCredential
export function refreshCredential(credential: ChatGPTCredential, fetcher: typeof fetch, nowMs?: number): Promise<ChatGPTCredential>
export function withRefreshLease<T>(owner: string, readLease: () => { owner: string; expiresAt: number } | null, writeLease: (lease: { owner: string; expiresAt: number } | null) => boolean, operation: () => Promise<T>, timeoutMs?: number, leaseMs?: number): Promise<T>
export function refreshCredentialWithLatest(credential: ChatGPTCredential, fetcher: typeof fetch, readLatest: () => ChatGPTCredential | null, saveLatest: (credential: ChatGPTCredential) => void, nowMs?: number, runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>): Promise<ChatGPTCredential>
export function revokeCredential(credential: ChatGPTCredential, fetcher: typeof fetch): Promise<boolean>
