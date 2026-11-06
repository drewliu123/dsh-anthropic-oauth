/**
 * @file dsh-anthropic-oauth - Host plugin for DeepSeek Harness (DSH)
 * @author grloper <https://github.com/grloper>
 * @license MIT
 *
 * Bridges Claude (Anthropic) Pro/Max OAuth into DeepSeek Harness:
 * - Dual-stack loopback OAuth PKCE server with Google/Gmail sign-in
 * - Auto-refreshes access tokens and syncs credentials across DSH and Claude Code
 * - Live model catalog discovery (/v1/models)
 * - Live subscription rate limit & quota tracking (/v1/messages)
 */

import nodeFs from 'node:fs'
import nodeOs from 'node:os'
import nodePath from 'node:path'

export const name = 'dsh-anthropic-oauth'

// Where the shared Claude Code login lives. Overridable so a test profile never
// touches the real home directory (CLAUDE_CONFIG_DIR is Claude Code's own switch).
export function claudeCredsFile(env = process.env) {
  const dir = env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR || env.CLAUDE_CONFIG_DIR || nodePath.join(nodeOs.homedir(), '.claude')
  return nodePath.join(dir, '.credentials.json')
}

export function dshHome(env = process.env) {
  return env.DSH_HOME || nodePath.join(nodeOs.homedir(), '.dsh')
}

// The plugin only syncs a Claude login after the user connects it explicitly.
export function connectionFile(env = process.env) {
  return nodePath.join(dshHome(env), 'dsh-anthropic-oauth', 'connection.json')
}

function isConnected() {
  try { return JSON.parse(nodeFs.readFileSync(connectionFile(), 'utf8')).connected === true } catch { return false }
}

function setConnected(value) {
  const file = connectionFile()
  if (!value) { try { nodeFs.unlinkSync(file) } catch {} return }
  nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true })
  nodeFs.writeFileSync(file, JSON.stringify({ connected: true, at: Date.now() }), { mode: 0o600 })
}

// ---- model preferences -------------------------------------------------------------------------
export function prefsFile(env = process.env) {
  return nodePath.join(dshHome(env), 'dsh-anthropic-oauth', 'prefs.json')
}

export function readPrefs(env = process.env) {
  try {
    const value = JSON.parse(nodeFs.readFileSync(prefsFile(env), 'utf8'))
    return { enabledModels: Array.isArray(value.enabledModels) ? value.enabledModels.filter((id) => typeof id === 'string') : null }
  } catch {
    return { enabledModels: null }
  }
}

function writePrefs(prefs, env = process.env) {
  const file = prefsFile(env)
  nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true })
  nodeFs.writeFileSync(file, JSON.stringify(prefs), { mode: 0o600 })
}

// Which discovered models DSH should offer. `null` means all; the result is never empty,
// because an empty model list would leave the provider unusable.
export function applyEnabled(models, enabledIds) {
  if (!Array.isArray(enabledIds)) return models
  const wanted = new Set(enabledIds)
  const kept = models.filter((model) => wanted.has(model.id))
  return kept.length ? kept : models
}

// Only the fields llm-pi-ai's provider schema knows; discovery metadata (effort levels, ...) must not reach settings.
export function toProviderModel(model) {
  return { id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens, ...(model.reasoning ? { reasoning: true } : {}) }
}

// ---- quota -------------------------------------------------------------------------------------
const PRIMARY_WINDOWS = ['five_hour', 'seven_day']

function toUnixSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value > 1e12 ? value / 1000 : value)
  if (typeof value === 'string') {
    const time = Date.parse(value)
    if (Number.isFinite(time)) return Math.floor(time / 1000)
  }
  return null
}

function windowStatus(utilization) {
  return utilization >= 1 ? 'rejected' : utilization >= 0.8 ? 'allowed_warning' : 'allowed'
}

// Convert the read-only usage endpoint's payload into the plugin's quota shape.
// ASSUMPTION (not verified against a live account): each window is `{ utilization: 0..100, resets_at: ISO time }`.
// Anything that does not look like that returns null, so callers fall back instead of showing wrong numbers.
export function normalizeUsage(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null
  const read = (entry) => {
    if (!entry || typeof entry !== 'object') return null
    const percent = entry.utilization
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return null
    const utilization = percent / 100
    return { status: windowStatus(utilization), utilization, reset: toUnixSeconds(entry.resets_at ?? entry.reset_at) }
  }
  const fiveHour = read(value.five_hour)
  const sevenDay = read(value.seven_day)
  if (!fiveHour && !sevenDay) return null
  const extra = []
  for (const [id, entry] of Object.entries(value)) {
    if (PRIMARY_WINDOWS.includes(id)) continue
    const parsed = read(entry)
    if (parsed) extra.push({ id, ...parsed })
  }
  const empty = { status: null, utilization: null, reset: null }
  const worst = Math.max(fiveHour?.utilization ?? 0, sevenDay?.utilization ?? 0)
  return {
    model: null,
    status: windowStatus(worst),
    representative: (sevenDay?.utilization ?? -1) > (fiveHour?.utilization ?? -1) ? 'seven_day' : 'five_hour',
    reset: null,
    fiveHour: fiveHour || empty,
    sevenDay: sevenDay || empty,
    extra,
    overageStatus: null,
    fetchedAt: Math.floor(now / 1000),
    httpStatus: 200,
    errorMessage: null,
    source: 'usage',
  }
}

function readJson(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('Request body too large.')); try { req.destroy() } catch {} } else chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('Invalid JSON body.')) }
    })
    req.on('error', reject)
  })
}
export const inject = ['credentials', 'settings', 'fs', 'timer']

// OAuth callback values are untrusted text, never HTML markup.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char])
}


const CLIENT_ID_B64 = 'OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl'
const TOKEN_URL = 'https://claude.ai/v1/oauth/token'
const API_BASE = 'https://api.anthropic.com'
const MODELS_URL = API_BASE + '/v1/models?limit=1000'
const MESSAGES_URL = API_BASE + '/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const CREDS_REF = 'ANTHROPIC_OAUTH_TOKEN'
const CREDS_REF_ALIAS = 'CLAUDE_CODE_OAUTH_TOKEN'
const PROVIDER_KEY = 'anthropic'
const REFRESH_SKEW_MS = 5 * 60 * 1000 // refresh if < 5m remaining
const MODELS_TTL_MS = 6 * 60 * 60 * 1000 // re-pull models at most every 6h
const QUOTA_TTL_MS = 5 * 60 * 1000 // a quota probe is a real request: cache it for 5 min
const USAGE_URL = API_BASE + '/api/oauth/usage' // read-only, costs no quota (shape unverified, see normalizeUsage)
const USAGE_TTL_MS = 60 * 1000
const USAGE_UNAVAILABLE_MS = 30 * 60 * 1000 // after an unusable answer, do not ask again for a while
export const CLAUDE_SCOPE = process.env.CLAUDE_OAUTH_SCOPES || 'user:profile user:inference'
const CLAUDE_CODE_VERSION_FALLBACK = '2.1.260'

const OAUTH_DISCOVERY_BETAS = ['oauth-2025-04-20', 'claude-code-20250219']

let _clientId = null
export function getClientId() {
  if (_clientId) return _clientId
  try {
    _clientId = (typeof atob === 'function')
      ? atob(CLIENT_ID_B64)
      : Buffer.from(CLIENT_ID_B64, 'base64').toString('utf8')
  } catch {
    _clientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
  }
  return _clientId
}

let _ccVersion = null
export async function getClaudeCodeVersion() {
  if (_ccVersion) return _ccVersion
  for (const cmd of ['claude', 'claude-code']) {
    try {
      const cp = await import('node:child_process')
      const out = cp.execFileSync(cmd, ['--version'], { timeout: 4000, encoding: 'utf8' })
      const v = String(out).trim().split(/\s+/)[0]
      if (v && /^\d/.test(v)) { _ccVersion = v; return _ccVersion }
    } catch {}
  }
  _ccVersion = CLAUDE_CODE_VERSION_FALLBACK
  return _ccVersion
}

export async function claudeCodeHeaders(accessToken, betas) {
  const v = await getClaudeCodeVersion()
  return {
    authorization: `Bearer ${accessToken}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': betas.join(','),
    'anthropic-dangerous-direct-browser-access': 'true',
    'user-agent': `claude-cli/${v} (external, sdk-cli)`,
    'x-app': 'cli',
    'x-stainless-lang': 'js',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': (typeof process !== 'undefined' && process.version) || 'v22.0.0',
    'x-stainless-package-version': '0.94.0',
    'x-stainless-timeout': '600',
    'x-stainless-async': 'false',
    'x-anthropic-billing-header': `cc_version=${v}; cc_entrypoint=sdk-cli; cch=00000;`,
  }
}

export function apply(ctx) {
  let stopped = false
  let timerHandle = null
  let fsWatcher = null
  let lastAuthState = {
    ok: false,
    message: 'initializing',
    expiresAt: null,
    tier: null,
    sub: null,
    email: null,
    rateLimit: null
  }
  let lastSyncOk = false
  let modelsCache = null
  let quotaCache = null
  let usageCache = null
  let usageUnavailableUntil = 0
  let activeLoginFlow = null

  async function readClaudeCreds() {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const file = claudeCredsFile()
    if (!fs.existsSync(file)) return null
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const j = JSON.parse(raw)
      if (!j || !j.claudeAiOauth) return null
      return { file, json: j, oauth: j.claudeAiOauth }
    } catch {
      return null
    }
  }

  async function writeClaudeCreds(file, json) {
    const fs = await import('node:fs')
    fs.writeFileSync(file, JSON.stringify(json, null, 2))
    try { fs.chmodSync(file, 0o600) } catch {}
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': `claude-cli/${await getClaudeCodeVersion()} (external, cli)`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const txt = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} ${txt.slice(0, 600)} url=${url}`)
    return txt
  }

  async function refreshIfNeeded() {
    const creds = await readClaudeCreds()
    if (!creds || !creds.oauth || !creds.oauth.accessToken || !creds.oauth.refreshToken) {
      throw new Error('Not logged in to Claude. Please sign in.')
    }
    const { file, json, oauth } = creds
    const now = Date.now()
    const exp = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : 0
    if (exp && exp - now > REFRESH_SKEW_MS) return { file, json, oauth }

    console.log(`[claude-oauth] token expires in ${exp ? ((exp - now) / 60000).toFixed(1) : 'unknown'}m — refreshing`)
    const body = await postJson(TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: getClientId(),
      refresh_token: oauth.refreshToken,
    })
    const data = JSON.parse(body)
    const newExpiresAt = Date.now() + (typeof data.expires_in === 'number' ? data.expires_in * 1000 : 3600 * 1000)
    json.claudeAiOauth.accessToken = data.access_token
    json.claudeAiOauth.refreshToken = data.refresh_token || oauth.refreshToken
    json.claudeAiOauth.expiresAt = newExpiresAt
    await writeClaudeCreds(file, json)
    console.log(`[claude-oauth] refreshed, new expiry ${new Date(newExpiresAt).toISOString()}`)
    return { file, json, oauth: json.claudeAiOauth }
  }

  async function fetchAnthropicModels(accessToken) {
    if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models
    const headers = await claudeCodeHeaders(accessToken, OAUTH_DISCOVERY_BETAS)
    const res = await fetch(MODELS_URL, { method: 'GET', headers, signal: AbortSignal.timeout(15000) })
    const txt = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} ${txt.slice(0, 400)} url=${MODELS_URL}`)
    const data = JSON.parse(txt)
    const rows = Array.isArray(data && data.data) ? data.data : []
    const models = rows
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => {
        const ctxWin = Number(m.max_input_tokens) || 200000
        const out = Number(m.max_tokens) || 64000
        const model = {
          id: m.id,
          name: m.display_name || m.id,
          contextWindow: ctxWin,
          maxTokens: out,
        }
        const caps = m.capabilities || {}
        if (caps.thinking && caps.thinking.supported) model.reasoning = true
        if (caps.effort && caps.effort.supported) {
          model.effortLevels = ['low', 'medium', 'high', 'xhigh', 'max']
            .filter((lvl) => caps.effort[lvl] && caps.effort[lvl].supported)
        }
        return model
      })
    if (!models.length) throw new Error('models list empty')
    modelsCache = { at: Date.now(), models }
    return models
  }

  function pickProbeModel() {
    const ids = modelsCache && Array.isArray(modelsCache.models)
      ? modelsCache.models.map((m) => m.id)
      : []
    return ids.find((i) => /haiku/i.test(i)) || ids[ids.length - 1] || 'claude-haiku-4-5'
  }

  async function fetchQuota(accessToken, opts) {
    const force = opts && opts.force === true
    if (!force && quotaCache && Date.now() - quotaCache.at < QUOTA_TTL_MS) return quotaCache.data
    const model = pickProbeModel()
    const headers = await claudeCodeHeaders(accessToken, OAUTH_DISCOVERY_BETAS)
    let res
    try {
      res = await fetch(MESSAGES_URL, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
          system: "You are Claude Code, Anthropic's official CLI for Claude.",
        }),
      })
    } catch {
      throw new Error('Quota probe failed. Please try again later.')
    }
    if (res.status === 401 || res.status === 403) throw new Error(`OAuth token rejected (${res.status})`)
    await res.text().catch(() => '')
    const H = res.headers
    const num = (key, max = Infinity) => {
      const value = H.get(key)
      if (value == null || !value.trim() || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null
      const number = Number(value)
      return Number.isFinite(number) && number >= 0 && number <= max ? number : null
    }
    const s = (key) => {
      const value = H.get(key)
      return ['allowed', 'allowed_warning', 'rejected'].includes(value) ? value : null
    }
    const status5h = s('anthropic-ratelimit-unified-5h-status')
    const util5h = num('anthropic-ratelimit-unified-5h-utilization', 1)
    const util7d = num('anthropic-ratelimit-unified-7d-utilization', 1)
    const reset5h = num('anthropic-ratelimit-unified-5h-reset') ?? num('anthropic-ratelimit-unified-reset')
    const rejected = s('anthropic-ratelimit-unified-status') === 'rejected' || status5h === 'rejected' || s('anthropic-ratelimit-unified-7d-status') === 'rejected' || util5h === 1 || util7d === 1
    if ((util5h === null && util7d === null) || (!res.ok && !(res.status === 429 && rejected))) {
      throw new Error(`Quota probe returned an unusable response (HTTP ${res.status}). Please try again later.`)
    }
    const data = {
      model,
      status: s('anthropic-ratelimit-unified-status') || (res.status === 429 ? 'rejected' : 'unknown'),
      representative: H.get('anthropic-ratelimit-unified-representative-claim') === 'seven_day' ? 'seven_day' : 'five_hour',
      reset: num('anthropic-ratelimit-unified-reset'),
      fiveHour: {
        status: status5h,
        utilization: util5h,
        reset: reset5h,
      },
      sevenDay: {
        status: s('anthropic-ratelimit-unified-7d-status'),
        utilization: util7d,
        reset: num('anthropic-ratelimit-unified-7d-reset'),
      },
      overageStatus: s('anthropic-ratelimit-unified-overage-status'),
      extra: [],
      fetchedAt: Math.floor(Date.now() / 1000),
      httpStatus: res.status,
      errorMessage: null,
      source: 'probe',
    }
    quotaCache = { at: Date.now(), data }
    return data
  }

  // Preferred source: a read-only endpoint, so it can be refreshed automatically without spending quota.
  async function fetchUsageEndpoint(accessToken, opts) {
    const force = opts && opts.force === true
    if (!force && usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return usageCache.data
    if (!force && Date.now() < usageUnavailableUntil) return null // a manual refresh may retry
    let res
    try {
      res = await fetch(USAGE_URL, { method: 'GET', headers: await claudeCodeHeaders(accessToken, OAUTH_DISCOVERY_BETAS), signal: AbortSignal.timeout(15000) })
    } catch {
      return usageCache ? usageCache.data : null // transient network problem: keep what we had
    }
    if (res.status === 401 || res.status === 403) throw new Error(`OAuth token rejected (${res.status})`)
    if (res.status === 429) return usageCache ? usageCache.data : null
    let data = null
    if (res.ok) { try { data = normalizeUsage(await res.json()) } catch {} }
    if (!data) { usageUnavailableUntil = Date.now() + USAGE_UNAVAILABLE_MS; return null }
    usageCache = { at: Date.now(), data }
    return data
  }

  // Free source first. A paid probe (one minimal real request) happens only when the user explicitly refreshes.
  async function readQuota(accessToken, opts) {
    const force = opts && opts.force === true
    const free = await fetchUsageEndpoint(accessToken, { force })
    if (free) return free
    if (force) return fetchQuota(accessToken, { force: true })
    return quotaCache ? quotaCache.data : null
  }

  function optionalService(serviceName) {
    try { return ctx.get(serviceName) } catch { return undefined }
  }

  // The model catalog as the settings page shows it: everything discovered, flagged by what DSH currently offers.
  function modelsView() {
    const all = modelsCache ? modelsCache.models : []
    const offered = new Set(applyEnabled(all, readPrefs().enabledModels).map((m) => m.id))
    const service = optionalService('agentDefaultModel')
    let defaultModel = null
    try {
      const selection = service && typeof service.currentSelection === 'function' ? service.currentSelection() : null
      if (selection && selection.provider === PROVIDER_KEY) defaultModel = selection.model
    } catch {}
    return {
      models: all.map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, maxTokens: m.maxTokens, reasoning: !!m.reasoning, enabled: offered.has(m.id) })),
      defaultModel,
      canSetDefault: !!(service && typeof service.saveSelection === 'function'),
      modelsAt: modelsCache ? modelsCache.at : null,
    }
  }

  async function syncToDshCredentials(accessToken) {
    const creds = ctx.get('credentials')
    if (!creds) return false
    try {
      let ref = CREDS_REF
      try {
        const m = await import('@deepseek-ai/dsh-credentials')
        if (m && typeof m.credentialRef === 'function') ref = m.credentialRef(CREDS_REF)
      } catch {}
      await creds.set(ref, accessToken)
      lastSyncOk = true
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      if (String(msg).includes('shadowed') || String(msg).includes('read-only')) {
        console.warn('[claude-oauth] credentials.set shadowed by env:', msg)
        return true
      }
      console.error('[claude-oauth] credentials.set failed:', msg)
      return false
    }
    try {
      let aliasRef = CREDS_REF_ALIAS
      try {
        const m = await import('@deepseek-ai/dsh-credentials')
        if (m && typeof m.credentialRef === 'function') aliasRef = m.credentialRef(CREDS_REF_ALIAS)
      } catch {}
      await creds.set(aliasRef, accessToken)
    } catch {}
    return true
  }

  async function ensureAnthropicProvider(accessToken, strict = false) {
    const settings = ctx.get('settings')
    let models
    try {
      models = await fetchAnthropicModels(accessToken)
      console.log(`[claude-oauth] pulled ${models.length} models from /v1/models`)
    } catch (e) {
      // Never invent a model list: leave the provider settings as they are and surface the failure.
      if (strict) throw e
      console.warn('[claude-oauth] model discovery failed; provider settings left unchanged:', e && e.message ? e.message : e)
      return false
    }

    // Offer only the models the user enabled (all of them until they choose otherwise).
    const offered = applyEnabled(models, readPrefs().enabledModels).map(toProviderModel)
    const provider = {
      displayName: 'Anthropic (Claude OAuth)',
      apiKeyEnv: CREDS_REF,
      api: 'anthropic-messages',
      baseURL: API_BASE,
      models: offered,
    }

    try {
      const cur = settings.get('llm-pi-ai')
      const existing = cur && cur.providers && cur.providers[PROVIDER_KEY]
      if (existing && JSON.stringify(existing.models) === JSON.stringify(offered)) {
        return false
      }
    } catch {}

    const patch = { providers: { [PROVIDER_KEY]: provider } }
    try {
      if (typeof settings.update === 'function') {
        await settings.update('llm-pi-ai', patch)
      } else if (typeof settings.mutate === 'function') {
        await settings.mutate('llm-pi-ai', [{ op: 'add', path: ['providers', PROVIDER_KEY], value: provider }])
      } else {
        const fs = await import('node:fs')
        const os = await import('node:os')
        const path = await import('node:path')
        const file = path.join(dshHome(), 'settings.yaml')
        let yaml = fs.readFileSync(file, 'utf8')
        const modelLines = offered.map((m) =>
          [
            `        - id: ${m.id}`,
            `          name: ${JSON.stringify(m.name)}`,
            `          contextWindow: ${m.contextWindow}`,
            `          maxTokens: ${m.maxTokens}`,
          ].join('\n')).join('\n')
        const block = [
          `    ${PROVIDER_KEY}:`,
          `      displayName: Anthropic (Claude OAuth)`,
          `      apiKeyEnv: ${CREDS_REF}`,
          `      api: anthropic-messages`,
          `      baseURL: ${API_BASE}`,
          `      models:`,
          modelLines,
        ].join('\n') + '\n'
        if (/^\s+anthropic:\s*$/m.test(yaml)) {
          // already exists
        } else {
          yaml = yaml.replace(/(providers:\n)/, `$1${block}`)
          fs.writeFileSync(file, yaml)
        }
      }
      console.log('[claude-oauth] ensured llm-pi-ai.providers.anthropic in settings')
      return true
    } catch (e) {
      if (strict) throw e
      console.error('[claude-oauth] ensure provider failed:', e)
      return false
    }
  }

  async function saveClaudeTokens(data) {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')

    // 1. Claude Code credentials file (see claudeCredsFile)
    const file = claudeCredsFile()
    let existing = {}
    try {
      if (fs.existsSync(file)) {
        existing = JSON.parse(fs.readFileSync(file, 'utf8'))
      }
    } catch {}
    existing.claudeAiOauth = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      scopes: [
        'user:file_upload',
        'user:inference',
        'user:mcp_servers',
        'user:profile',
        'user:sessions:claude_code'
      ],
      subscriptionType: data.sub || 'pro',
      rateLimitTier: data.tier || 'default'
    }
    if (data.email) existing.claudeAiOauth.emailAddress = data.email
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(existing, null, 2))
    try { fs.chmodSync(file, 0o600) } catch {}

    // 2. Sync to DSH credentials
    await syncToDshCredentials(data.accessToken)

    // 3. The user signed in through this plugin: connect it
    setConnected(true)

    // 4. Ensure provider in settings
    await ensureAnthropicProvider(data.accessToken)
  }

  async function startOAuthFlow() {
    if (activeLoginFlow && Date.now() - activeLoginFlow.startedAt < 300000) {
      return activeLoginFlow
    }
    if (activeLoginFlow) {
      try { activeLoginFlow.cleanup() } catch {}
    }

    const crypto = await import('node:crypto')
    const http = await import('node:http')

    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('hex')

    let server4 = null
    let server6 = null
    let resolvedPort = 0
    let timeoutHandle = null

    const cleanup = () => {
      clearTimeout(timeoutHandle)
      try { if (server4) server4.close() } catch {}
      try { if (server6) server6.close() } catch {}
      activeLoginFlow = null
    }

    const handler = async (cReq, cRes) => {
      const u = new URL(cReq.url || '/', `http://${cReq.headers.host || 'localhost'}`)
      if (u.pathname === '/callback') {
        const code = u.searchParams.get('code')
        const returnedState = u.searchParams.get('state')
        const error = u.searchParams.get('error')
        if (error) {
          cRes.statusCode = 400
          cRes.setHeader('content-type', 'text/html; charset=utf-8')
          cRes.end(`<h1>Login failed: ${escapeHtml(error)}</h1><p>You can close this tab.</p>`)
          cleanup()
          return
        }
        if (returnedState !== state) {
          cRes.statusCode = 400
          cRes.setHeader('content-type', 'text/html; charset=utf-8')
          cRes.end('<h1>State mismatch. Please try again.</h1>')
          cleanup()
          return
        }
        if (!code) {
          cRes.statusCode = 400
          cRes.setHeader('content-type', 'text/html; charset=utf-8')
          cRes.end('<h1>Missing authorization code.</h1>')
          cleanup()
          return
        }

        try {
          const tokenRes = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': `claude-cli/${await getClaudeCodeVersion()} (external, cli)`
            },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              client_id: getClientId(),
              code,
              redirect_uri: `http://localhost:${resolvedPort}/callback`,
              code_verifier: verifier,
              state
            })
          })
          const tokens = await tokenRes.json()
          if (!tokenRes.ok || !tokens.access_token) {
            throw new Error(tokens.error_description || tokens.error || JSON.stringify(tokens))
          }

          let profile = {}
          try {
            const profRes = await fetch('https://api.anthropic.com/api/oauth/profile', {
              headers: { authorization: `Bearer ${tokens.access_token}` },
              signal: AbortSignal.timeout(10000)
            })
            if (profRes.ok) profile = await profRes.json()
          } catch {}

          const account = profile.account || {}
          const email = profile.emailAddress || profile.email || account.email_address || account.email || null
          const sub = profile.subscriptionType || profile.subscription_type || account.subscription_type || 'pro'
          const tier = account.rate_limit_tier || profile.rateLimitTier || 'default'

          await saveClaudeTokens({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            email,
            sub,
            tier
          })

          lastAuthState = {
            ok: true,
            message: 'bridged',
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            tier,
            sub,
            email
          }
          lastSyncOk = true

          cRes.statusCode = 200
          cRes.setHeader('content-type', 'text/html; charset=utf-8')
          cRes.end(`<!doctype html><html><head><title>Claude Login Successful</title><meta charset="utf-8">
<style>
body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#18181b;color:#f4f4f5}
.box{background:#27272a;border:1px solid #3f3f46;border-radius:16px;padding:36px;text-align:center;max-width:440px;box-shadow:0 10px 30px rgba(0,0,0,0.5)}
h1{font-size:20px;margin:0 0 10px;color:#d97706}
p{font-size:14px;color:#a1a1aa;line-height:1.5;margin:0 0 20px}
.pill{display:inline-block;background:#22c55e20;color:#22c55e;border:1px solid #22c55e40;padding:6px 16px;border-radius:999px;font-size:13px;font-weight:600;margin-bottom:16px}
.email{color:#f4f4f5;font-weight:600}
</style>
</head><body>
<div class="box">
  <div class="pill">&#10003; Logged in successfully</div>
  <h1>Claude Connected</h1>
  <p>Logged in as <span class="email">${escapeHtml(email || 'your account')}</span> (${escapeHtml(String(sub).toUpperCase())}).<br>You can close this tab and return to DeepSeek Harness.</p>
</div>
</body></html>`)

        } catch (err) {
          cRes.statusCode = 500
          cRes.setHeader('content-type', 'text/html; charset=utf-8')
          cRes.end(`<h1>Token exchange failed: ${escapeHtml(err.message)}</h1>`)
        } finally {
          cleanup()
        }
      } else {
        cRes.statusCode = 404
        cRes.end('Not found')
      }
    }

    server4 = http.createServer(handler)
    await new Promise((res) => server4.listen(0, '127.0.0.1', res))
    resolvedPort = server4.address().port

    // IPv6 is optional: a failed listen emits 'error' (not the callback), which used to hang the login forever.
    try {
      const v6 = http.createServer(handler)
      const bound = await new Promise((res) => { v6.once('error', () => res(false)); v6.listen(resolvedPort, '::1', () => res(true)) })
      server6 = bound ? v6 : null
    } catch {}

    const redirectUri = `http://localhost:${resolvedPort}/callback`
    const authUrl = `https://claude.ai/oauth/authorize?code=true&client_id=${getClientId()}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(CLAUDE_SCOPE)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`

    timeoutHandle = setTimeout(cleanup, 300000)
    timeoutHandle.unref?.()

    activeLoginFlow = { authUrl, startedAt: Date.now(), cleanup }
    return activeLoginFlow
  }

  async function oneShot() {
    if (stopped) return
    if (!isConnected()) {
      lastAuthState = { ok: false, message: 'Not connected.', expiresAt: null, tier: null, sub: null, email: null }
      return
    }
    try {
      const creds = await readClaudeCreds()
      if (!creds || !creds.oauth || !creds.oauth.accessToken || !creds.oauth.refreshToken) {
        lastAuthState = {
          ok: false,
          message: 'Not logged in to Claude. Click "Sign in with Google / Gmail" to connect.',
          expiresAt: null,
          tier: null,
          sub: null,
          email: null
        }
        return
      }
      const { oauth } = await refreshIfNeeded()
      const ok = await syncToDshCredentials(oauth.accessToken)
      if (!ok) {
        lastAuthState = { ok: false, message: 'sync shadowed or failed', expiresAt: oauth.expiresAt, tier: oauth.rateLimitTier || null, sub: oauth.subscriptionType || null, email: oauth.emailAddress || null }
      } else {
        await ensureAnthropicProvider(oauth.accessToken)
        // Keep any quota the user already fetched; probing is a real request, so it is on demand only.
        lastAuthState = { ok: true, message: 'bridged', expiresAt: oauth.expiresAt, tier: oauth.rateLimitTier || null, sub: oauth.subscriptionType || null, email: oauth.emailAddress || null, rateLimit: lastAuthState.rateLimit || null }
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      lastAuthState = { ok: false, message: msg.slice(0, 500), expiresAt: null, tier: null, sub: null, email: null }
      if (msg.includes('No claudeAiOauth') || msg.includes('ENOENT') || msg.includes('Not logged in')) {
        lastAuthState.message = 'Not logged in to Claude. Click "Sign in with Google / Gmail" to connect.'
      }
    }
  }

  void oneShot()

  const schedule = () => {
    if (stopped) return
    timerHandle = setTimeout(async () => {
      await oneShot()
      schedule()
    }, 60_000)
  }
  schedule()

  void (async () => {
    try {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')
      const file = claudeCredsFile()
      let debounce = null
      fsWatcher = fs.watch(file, () => {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => { void oneShot() }, 400)
      })
      fsWatcher.on('error', () => {})
    } catch {}
  })()

  try {
    const webServer = ctx.get('webServer')
    if (webServer) {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/dsh-anthropic-oauth/status',
        handler: async (req, res) => {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          const authenticated = !!(lastAuthState.ok && lastAuthState.expiresAt && lastAuthState.expiresAt > Date.now())
          // An existing Claude Code login is only offered, never used, until the user adopts it.
          const canAdopt = !isConnected() && !!(await readClaudeCreds())
          res.end(JSON.stringify({
            ...lastAuthState,
            authenticated,
            canAdopt,
            now: Date.now(),
            synced: lastSyncOk,
            models: modelsCache ? modelsCache.models.map((m) => ({
              id: m.id,
              name: m.name,
              contextWindow: m.contextWindow,
              reasoning: !!m.reasoning,
            })) : [],
            modelsAt: modelsCache ? modelsCache.at : null,
          }))
        },
      }))

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/dsh-anthropic-oauth/login',
        handler: async (req, res) => {
          try {
            const flow = await startOAuthFlow()
            const accept = req.headers.accept || ''
            if (req.method === 'GET' && (accept.includes('text/html') || !accept.includes('application/json'))) {
              res.writeHead(302, { Location: flow.authUrl })
              res.end()
              return
            }
            res.statusCode = 200
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: true, authUrl: flow.authUrl }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
        },
      }))

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/dsh-anthropic-oauth/logout',
        handler: async (req, res) => {
          try {
            // Disconnect from DSH only: the Claude Code CLI's own login file is left untouched.
            setConnected(false)
            try {
              const creds = ctx.get('credentials')
              if (creds) {
                await creds.delete(CREDS_REF).catch(() => {})
                await creds.delete(CREDS_REF_ALIAS).catch(() => {})
              }
            } catch {}
            lastAuthState = {
              ok: false,
              message: 'Not connected.',
              expiresAt: null,
              tier: null,
              sub: null,
              email: null
            }
            lastSyncOk = false
            quotaCache = null
            usageCache = null
            usageUnavailableUntil = 0
            modelsCache = null

            res.statusCode = 200
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
        },
      }))

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/dsh-anthropic-oauth/adopt',
        handler: async (req, res) => {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'POST required' })); return }
          if (!(await readClaudeCreds())) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'No existing Claude Code login was found.' })); return }
          setConnected(true)
          modelsCache = null
          await oneShot()
          res.statusCode = 200
          res.end(JSON.stringify({ ok: lastAuthState.ok, error: lastAuthState.ok ? undefined : lastAuthState.message }))
        },
      }))

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/dsh-anthropic-oauth/models',
        handler: async (req, res) => {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)) }
          try {
            if (!isConnected()) return send(200, { ok: false, error: 'Not connected.' })
            if (req.method === 'POST') {
              if (!String(req.headers['content-type'] || '').includes('application/json')) return send(415, { ok: false, error: 'A JSON body is required.' })
              if (!modelsCache) return send(200, { ok: false, error: 'The model list is not loaded yet. Sync the account first.' })
              let body
              try { body = await readJson(req) } catch (error) { return send(400, { ok: false, error: error.message }) }
              if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['enabled', 'defaultModel'].includes(key))) {
                return send(400, { ok: false, error: 'Expected model preferences as a JSON object.' })
              }
              const known = new Set(modelsCache.models.map((model) => model.id))
              const ids = body.enabled === undefined ? readPrefs().enabledModels : body.enabled
              if (body.enabled !== undefined && (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !known.has(id)))) {
                return send(400, { ok: false, error: 'Enable at least one known model.' })
              }
              const offered = new Set(applyEnabled(modelsCache.models, ids).map((model) => model.id))
              if (body.defaultModel !== undefined && (typeof body.defaultModel !== 'string' || !offered.has(body.defaultModel))) {
                return send(400, { ok: false, error: 'Choose one of the enabled models.' })
              }
              const service = optionalService('agentDefaultModel')
              if (body.defaultModel !== undefined && (!service || typeof service.saveSelection !== 'function' || typeof service.currentSelection !== 'function')) {
                return send(200, { ok: false, error: 'This DSH build cannot change the default model.' })
              }
              const previousDefault = structuredClone(service?.currentSelection?.() ?? null)
              if (previousDefault?.provider === PROVIDER_KEY && !offered.has(previousDefault.model) && body.defaultModel === undefined) {
                return send(400, { ok: false, error: 'Choose an enabled replacement before disabling the current default.' })
              }
              const settings = ctx.get('settings')
              if (body.enabled !== undefined && typeof settings.update !== 'function' && typeof settings.mutate !== 'function') {
                throw new Error('This DSH build cannot save model preferences.')
              }
              const previousProvider = structuredClone(settings.get('llm-pi-ai')?.providers?.[PROVIDER_KEY])
              const prefPath = prefsFile()
              const previousPrefsText = nodeFs.existsSync(prefPath) ? nodeFs.readFileSync(prefPath, 'utf8') : null
              let prefsAttempted = false
              let providerAttempted = false
              let defaultAttempted = false
              try {
                if (body.enabled !== undefined) {
                  const { oauth } = await refreshIfNeeded()
                  prefsAttempted = true
                  writePrefs({ enabledModels: [...new Set(ids)] })
                  providerAttempted = true
                  await ensureAnthropicProvider(oauth.accessToken, true)
                }
                if (body.defaultModel !== undefined) {
                  defaultAttempted = true
                  await service.saveSelection({ provider: PROVIDER_KEY, model: body.defaultModel })
                  const saved = service.currentSelection()
                  if (saved?.provider !== PROVIDER_KEY || saved.model !== body.defaultModel) throw new Error('The default model could not be saved.')
                }
              } catch (error) {
                const failures = []
                if (prefsAttempted) {
                  try {
                    if (previousPrefsText === null) { if (nodeFs.existsSync(prefPath)) nodeFs.unlinkSync(prefPath) }
                    else nodeFs.writeFileSync(prefPath, previousPrefsText, { mode: 0o600 })
                  } catch { failures.push('preferences') }
                }
                if (providerAttempted) {
                  try {
                    if (typeof settings.mutate === 'function') {
                      const operation = previousProvider === undefined
                        ? { op: 'remove', path: ['providers', PROVIDER_KEY] }
                        : { op: 'add', path: ['providers', PROVIDER_KEY], value: previousProvider }
                      await settings.mutate('llm-pi-ai', [operation])
                    } else if (typeof settings.update === 'function') {
                      await settings.update('llm-pi-ai', { providers: { [PROVIDER_KEY]: previousProvider } })
                    } else throw new Error('Settings cannot be restored.')
                  } catch { failures.push('provider settings') }
                }
                if (defaultAttempted) {
                  try {
                    await service.saveSelection(previousDefault)
                    const restored = service.currentSelection()
                    if ((restored?.provider ?? null) !== (previousDefault?.provider ?? null) || (restored?.model ?? null) !== (previousDefault?.model ?? null)) throw new Error('Default not restored.')
                  } catch { failures.push('default model') }
                }
                if (failures.length) throw new Error(`${error.message} Rollback failed for ${failures.join(', ')}.`)
                throw error
              }
            } else if (req.method !== 'GET') {
              return send(405, { ok: false, error: 'GET or POST required.' })
            }
            return send(200, { ok: true, ...modelsView() })
          } catch (err) {
            return send(500, { ok: false, error: err.message })
          }
        },
      }))

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/dsh-anthropic-oauth/sync',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          modelsCache = null
          await oneShot()
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ...lastAuthState }))
        },
      }))

      ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/api/dsh-anthropic-oauth/quota',
        handler: async (req, res) => {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          const force = req.method === 'POST' || /[?&]force=1\b/.test(req.url || '')
          try {
            if (!isConnected()) throw new Error('Not connected.')
            const { oauth } = await refreshIfNeeded()
            const data = await readQuota(oauth.accessToken, { force })
            res.statusCode = 200
            if (!data) {
              // No free source is available and the user did not ask for a (quota-spending) probe: say so, do not guess.
              res.end(JSON.stringify({ ok: true, source: 'none', manualRequired: true, sub: lastAuthState.sub, tier: lastAuthState.tier }))
              return
            }
            lastAuthState.rateLimit = data
            res.end(JSON.stringify({ ok: true, ...data, sub: lastAuthState.sub, tier: lastAuthState.tier }))
          } catch (e) {
            let msg = e && e.message ? e.message : String(e)
            if (msg.includes('OAuth token rejected (401)')) {
              msg = 'Authentication expired. Please sign in again in Settings.'
            } else if (msg.includes('rate_limit') || msg.includes('429')) {
              try {
                const match = msg.match(/"message":"([^"]+)"/)
                if (match && match[1]) msg = match[1]
                else msg = 'Rate limit reached. Quota will reset shortly.'
              } catch {
                msg = 'Rate limit reached. Quota will reset shortly.'
              }
            }
            res.statusCode = 200
            res.end(JSON.stringify({ ok: false, error: msg }))
          }
        },
      }))
    }
  } catch {}

  ctx.effect(() => () => {
    stopped = true
    if (timerHandle) clearTimeout(timerHandle)
    if (fsWatcher) try { fsWatcher.close() } catch {}
  })
}

export default { name, inject, apply }
