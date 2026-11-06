import { test } from 'node:test'
import assert from 'node:assert'
import { Readable } from 'node:stream'
import { normalizeUsage, applyEnabled, toProviderModel, readPrefs, prefsFile } from '../lib/index.js'

const MODELS = [
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextWindow: 200000, maxTokens: 64000, reasoning: true, effortLevels: ['low', 'high'] },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 1000000, maxTokens: 64000, reasoning: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 64000 },
]

test('normalizeUsage converts the read-only usage payload and rejects anything unexpected', () => {
  const usage = normalizeUsage({
    five_hour: { utilization: 42, resets_at: '2026-10-28T08:00:00+00:00' },
    seven_day: { utilization: 83.5, resets_at: '2026-10-31T08:00:00Z' },
    seven_day_opus: { utilization: 10, resets_at: null },
    seven_day_sonnet: null,
    extra_usage: { is_enabled: false },
  }, Date.parse('2026-10-28T04:00:00Z'))
  assert.strictEqual(usage.source, 'usage')
  assert.strictEqual(usage.fiveHour.utilization, 0.42)
  assert.strictEqual(usage.fiveHour.reset, Date.parse('2026-10-28T08:00:00Z') / 1000)
  assert.strictEqual(usage.sevenDay.status, 'allowed_warning')
  assert.strictEqual(usage.representative, 'seven_day')
  assert.deepStrictEqual(usage.extra.map((item) => item.id), ['seven_day_opus'])

  for (const value of [null, false, true, '', '42', [], [0], {}, NaN, Infinity, -1, 101]) {
    assert.strictEqual(normalizeUsage({ five_hour: { utilization: value } }), null, `reject ${String(value)}`)
  }
  assert.strictEqual(normalizeUsage({ five_hour: { utilization: 0 } }).fiveHour.utilization, 0)
  assert.strictEqual(normalizeUsage(null), null)
  assert.strictEqual(normalizeUsage({}), null)
  assert.strictEqual(normalizeUsage({ five_hour: { utilization: 120 } }), null) // out of range
  assert.strictEqual(normalizeUsage({ five_hour: { utilization: 'high' } }), null)
  assert.strictEqual(normalizeUsage({ error: { type: 'not_found' } }), null)
  assert.strictEqual(normalizeUsage({ five_hour: { utilization: 100 } }).fiveHour.status, 'rejected')
})

test('model preferences never produce an empty list and only keep schema fields', () => {
  assert.deepStrictEqual(applyEnabled(MODELS, null), MODELS)
  assert.deepStrictEqual(applyEnabled(MODELS, ['claude-haiku-4-5']).map((m) => m.id), ['claude-haiku-4-5'])
  assert.deepStrictEqual(applyEnabled(MODELS, []), MODELS)
  assert.deepStrictEqual(applyEnabled(MODELS, ['gone']), MODELS)
  assert.deepStrictEqual(Object.keys(toProviderModel(MODELS[0])).sort(), ['contextWindow', 'id', 'maxTokens', 'name', 'reasoning'])
  assert.ok(!('reasoning' in toProviderModel(MODELS[2])))
  assert.strictEqual(readPrefs({ DSH_HOME: '/nonexistent-aoauth' }).enabledModels, null)
  assert.ok(prefsFile({ DSH_HOME: '/x' }).endsWith('/x/dsh-anthropic-oauth/prefs.json'))
})

// Boots the real host plugin against a fake DSH and a fake network, then drives the HTTP routes.
test('host serves models, persists enable/disable and default, and reads quota without spending it', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoauth-mq-'))
  const claudeDir = path.join(tmp, 'claude')
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.mkdirSync(path.join(tmp, 'dsh-anthropic-oauth'), { recursive: true })
  fs.writeFileSync(path.join(claudeDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-FAKE', refreshToken: 'sk-ant-ort01-FAKE', expiresAt: Date.now() + 864e5, subscriptionType: 'pro', emailAddress: 'a@example.invalid' } }))
  fs.writeFileSync(path.join(tmp, 'dsh-anthropic-oauth', 'connection.json'), JSON.stringify({ connected: true }))
  process.env.DSH_HOME = tmp
  process.env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR = claudeDir

  const realFetch = globalThis.fetch
  const calls = []
  let usageMode = 'ok'
  let probeStatus = 200
  let probeHeaders = { 'anthropic-ratelimit-unified-5h-utilization': '0.5', 'anthropic-ratelimit-unified-5h-status': 'allowed', 'anthropic-ratelimit-unified-5h-reset': '1793000000', 'anthropic-ratelimit-unified-7d-utilization': '0.2', 'anthropic-ratelimit-unified-7d-status': 'allowed', 'anthropic-ratelimit-unified-7d-reset': '1793500000' }
  let probeNetworkError = false
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    calls.push(`${init.method || 'GET'} ${new URL(target).pathname}`)
    if (target.includes('/v1/models')) {
      return new Response(JSON.stringify({ data: MODELS.map((m) => ({ id: m.id, display_name: m.name, max_input_tokens: m.contextWindow, max_tokens: m.maxTokens, capabilities: { thinking: { supported: !!m.reasoning }, effort: { supported: !!m.effortLevels, low: { supported: true }, high: { supported: true } } } })) }), { status: 200 })
    }
    if (target.includes('/api/oauth/usage')) {
      if (usageMode === 'ok') return new Response(JSON.stringify({ five_hour: { utilization: 42, resets_at: '2026-10-28T08:00:00Z' }, seven_day: { utilization: 17, resets_at: '2026-11-02T08:00:00Z' } }), { status: 200 })
      return new Response(JSON.stringify({ error: { type: 'not_found_error' } }), { status: 404 })
    }
    if (target.includes('/v1/messages')) {
      if (probeNetworkError) throw new Error('network failure with sk-ant-oat01-FAKE')
      return new Response(JSON.stringify({ error: { message: 'private account detail sk-ant-oat01-FAKE' } }), { status: probeStatus, headers: probeHeaders })
    }
    return new Response('{}', { status: 404 })
  }

  const routes = new Map()
  const disposers = []
  const updates = []
  let savedDefault = null
  let provider
  let failSettings = false
  let defaultMode = 'ok'
  const services = {
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
    credentials: { set: async () => {}, delete: async () => {} },
    settings: { get: () => ({ providers: { anthropic: provider } }), update: async (ns, patch) => {
      provider = structuredClone(patch.providers.anthropic)
      updates.push(provider?.models.map((m) => m.id))
      if (failSettings) { failSettings = false; throw new Error('Settings disk write failed') }
    } },
    agentDefaultModel: { currentSelection: () => savedDefault, saveSelection: async (selection) => {
      if (defaultMode === 'noop') return
      savedDefault = selection
      if (defaultMode === 'throw') { defaultMode = 'ok'; throw new Error('Default disk write failed') }
    } },
  }
  const ctx = { get: (service) => services[service], effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) } }
  const call = async (route, { method = 'GET', body, rawBody } = {}) => {
    const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
    const req = Readable.from(payload === undefined ? [] : [Buffer.from(payload)])
    Object.assign(req, { method, url: `/api/dsh-anthropic-oauth/${route}`, headers: payload === undefined ? {} : { 'content-type': 'application/json' } })
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(text) { this.body = text || '' } }
    await routes.get(`/api/dsh-anthropic-oauth/${route.split('?')[0]}`)(req, res)
    return { status: res.statusCode, json: JSON.parse(res.body) }
  }

  try {
    const plugin = await import('../lib/index.js')
    plugin.apply(ctx)
    for (let i = 0; i < 50 && !(await call('models')).json.models?.length; i++) await new Promise((r) => setTimeout(r, 40))

    // Everything is offered until the user chooses; only schema fields reach DSH settings.
    let view = (await call('models')).json
    assert.deepStrictEqual(view.models.map((m) => [m.id, m.enabled]), [['claude-opus-4-5', true], ['claude-sonnet-4-5', true], ['claude-haiku-4-5', true]])
    assert.deepStrictEqual(updates.at(-1), ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'])
    assert.strictEqual(view.canSetDefault, true)

    // Failed first writes restore the absence of preferences and the previous provider.
    const initialProvider = structuredClone(provider)
    assert.strictEqual((await call('models', { method: 'POST', rawBody: '{"enabled":' })).status, 400)
    assert.strictEqual(fs.existsSync(prefsFile()), false)
    failSettings = true
    assert.strictEqual((await call('models', { method: 'POST', body: { enabled: ['claude-haiku-4-5'] } })).status, 500)
    assert.strictEqual(fs.existsSync(prefsFile()), false)
    assert.deepStrictEqual(provider, initialProvider)
    const defaultService = services.agentDefaultModel
    delete services.agentDefaultModel
    const unsupported = await call('models', { method: 'POST', body: { enabled: ['claude-haiku-4-5'], defaultModel: 'claude-haiku-4-5' } })
    assert.strictEqual(unsupported.json.ok, false)
    assert.strictEqual(fs.existsSync(prefsFile()), false)
    assert.deepStrictEqual(provider, initialProvider)
    services.agentDefaultModel = defaultService

    // Disable models: persisted, applied to DSH, and visible on the next read.
    const keep = await call('models', { method: 'POST', body: { enabled: ['claude-haiku-4-5', 'claude-sonnet-4-5'] } })
    assert.strictEqual(keep.status, 200)
    assert.deepStrictEqual(keep.json.models.filter((m) => m.enabled).map((m) => m.id), ['claude-sonnet-4-5', 'claude-haiku-4-5'])
    assert.deepStrictEqual(updates.at(-1), ['claude-sonnet-4-5', 'claude-haiku-4-5'])
    assert.deepStrictEqual(readPrefs().enabledModels, ['claude-haiku-4-5', 'claude-sonnet-4-5'])

    // Invalid choices are refused and change nothing.
    assert.strictEqual((await call('models', { method: 'POST', body: { enabled: [] } })).status, 400)
    assert.strictEqual((await call('models', { method: 'POST', body: { enabled: ['nope'] } })).status, 400)
    assert.strictEqual((await call('models', { method: 'POST', body: { defaultModel: 'claude-opus-4-5' } })).status, 400) // disabled
    assert.strictEqual(savedDefault, null)

    // The default goes through DSH's own service.
    const chosen = await call('models', { method: 'POST', body: { defaultModel: 'claude-haiku-4-5' } })
    assert.deepStrictEqual(savedDefault, { provider: 'anthropic', model: 'claude-haiku-4-5' })
    assert.strictEqual(chosen.json.defaultModel, 'claude-haiku-4-5')

    // Validate the entire body and resulting default/enabled combination before writing anything.
    const snapshot = () => ({ prefs: fs.readFileSync(prefsFile(), 'utf8'), provider: structuredClone(provider), savedDefault: structuredClone(savedDefault) })
    const before = snapshot()
    for (const body of [null, [], false, 'bad', { unknown: true }, { enabled: ['claude-haiku-4-5', 'unknown'] }, { enabled: ['claude-haiku-4-5', null] }, { enabled: ['claude-sonnet-4-5'], defaultModel: 'unknown' }, { enabled: ['claude-sonnet-4-5'] }]) {
      const rejected = await call('models', { method: 'POST', body })
      assert.strictEqual(rejected.status, 400, JSON.stringify(body))
      assert.deepStrictEqual(snapshot(), before)
    }
    const changes = { enabled: ['claude-sonnet-4-5'], defaultModel: 'claude-sonnet-4-5' }
    failSettings = true // The fake mutates its in-memory state before its disk write fails.
    let failure = await call('models', { method: 'POST', body: changes })
    assert.strictEqual(failure.status, 500)
    assert.match(failure.json.error, /Settings disk write failed/)
    assert.deepStrictEqual(snapshot(), before)
    defaultMode = 'throw' // Saving the default may also mutate first, then throw.
    failure = await call('models', { method: 'POST', body: changes })
    assert.strictEqual(failure.status, 500)
    assert.deepStrictEqual(snapshot(), before)
    defaultMode = 'noop' // A swallowed save failure must not be reported as success.
    failure = await call('models', { method: 'POST', body: changes })
    assert.strictEqual(failure.status, 500)
    assert.match(failure.json.error, /could not be saved/)
    assert.deepStrictEqual(snapshot(), before)
    defaultMode = 'ok'
    assert.strictEqual((await call('models', { method: 'POST', body: changes })).json.defaultModel, 'claude-sonnet-4-5')

    // Quota: the read-only endpoint is used and no inference request is made.
    calls.length = 0
    const free = (await call('quota')).json
    assert.strictEqual(free.source, 'usage')
    assert.strictEqual(free.fiveHour.utilization, 0.42)
    assert.ok(!calls.some((c) => c.includes('/v1/messages')), 'a free read must not send a message')

    // Endpoint unusable: automatic reads spend nothing and say a manual refresh is needed.
    usageMode = 'missing'
    await call('logout', { method: 'POST', body: {} })
    fs.writeFileSync(path.join(tmp, 'dsh-anthropic-oauth', 'connection.json'), JSON.stringify({ connected: true }))
    calls.length = 0
    const none = (await call('quota')).json
    assert.strictEqual(none.source, 'none')
    assert.strictEqual(none.manualRequired, true)
    assert.ok(!calls.some((c) => c.includes('/v1/messages')), 'no background probe')

    // An explicit refresh may spend one minimal request.
    const probed = (await call('quota?force=1')).json
    assert.strictEqual(probed.source, 'probe')
    assert.strictEqual(calls.filter((c) => c.includes('/v1/messages')).length, 1)
    const cached = (await call('quota')).json
    const validHeaders = { ...probeHeaders }
    for (const status of [400, 404, 500, 503, 429]) {
      probeStatus = status
      const failed = (await call('quota?force=1')).json
      assert.strictEqual(failed.ok, false, `HTTP ${status}`)
      assert.ok(!failed.error.includes('private account'))
      assert.ok(!failed.error.includes('sk-ant-'))
      assert.deepStrictEqual((await call('quota')).json, cached, 'a failed refresh preserves the valid cache')
    }
    probeStatus = 200
    for (const invalid of ['', ' ', 'NaN', 'Infinity', '-0.1', '1.1', 'false', '0x1']) {
      probeHeaders = { 'anthropic-ratelimit-unified-5h-utilization': invalid }
      assert.strictEqual((await call('quota?force=1')).json.ok, false, `header ${invalid}`)
      assert.deepStrictEqual((await call('quota')).json, cached)
    }
    probeHeaders = { ...validHeaders, 'anthropic-ratelimit-unified-5h-reset': 'Infinity', 'anthropic-ratelimit-unified-7d-reset': '-1' }
    const invalidResets = (await call('quota?force=1')).json
    assert.strictEqual(invalidResets.ok, true)
    assert.strictEqual(invalidResets.fiveHour.reset, null)
    assert.strictEqual(invalidResets.sevenDay.reset, null)
    probeHeaders = { 'anthropic-ratelimit-unified-7d-utilization': '1', 'anthropic-ratelimit-unified-7d-status': 'rejected' }
    probeStatus = 429
    const exhausted = (await call('quota?force=1')).json
    assert.strictEqual(exhausted.ok, true)
    assert.strictEqual(exhausted.sevenDay.utilization, 1)
    assert.strictEqual(exhausted.fiveHour.utilization, null, 'do not invent five-hour exhaustion')
    probeNetworkError = true
    const networkFailure = (await call('quota?force=1')).json
    assert.strictEqual(networkFailure.ok, false)
    assert.ok(!networkFailure.error.includes('sk-ant-'))
    assert.deepStrictEqual((await call('quota')).json, exhausted)
  } finally {
    for (const dispose of disposers) dispose()
    globalThis.fetch = realFetch
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.DSH_HOME
    delete process.env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR
  }
})
