import { test } from 'node:test'
import assert from 'node:assert'
import crypto from 'node:crypto'
import { getClientId, getClaudeCodeVersion, claudeCodeHeaders, name, inject, escapeHtml, CLAUDE_SCOPE, claudeCredsFile, dshHome, connectionFile } from '../lib/index.js'

test('login endpoint starts the OAuth flow and returns a valid Claude authorization URL', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoauth-test-'))
  process.env.DSH_HOME = tmp
  process.env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR = path.join(tmp, 'claude')
  const routes = new Map()
  const disposers = []
  const ctx = {
    get: (service) => (service === 'webServer' ? { register: (route) => { routes.set(route.path, route.handler); return () => {} } } : null),
    effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
  }
  const call = async (path, headers) => {
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v }, writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]))) }, end(body) { this.body = body || '' } }
    await routes.get(path)({ method: 'GET', headers, url: path }, res)
    return res
  }
  try {
    const plugin = await import('../lib/index.js')
    plugin.apply(ctx)

    const json = await call('/api/dsh-anthropic-oauth/login', { accept: 'application/json' })
    const { ok, authUrl, expiresAt } = JSON.parse(json.body)
    assert.strictEqual(ok, true)
    assert.ok(expiresAt > Date.now() + 14 * 60 * 1000)
    assert.ok(expiresAt <= Date.now() + 15 * 60 * 1000)
    const sameFlow = await call('/api/dsh-anthropic-oauth/login', { accept: 'application/json' })
    assert.strictEqual(JSON.parse(sameFlow.body).expiresAt, expiresAt)
    const url = new URL(authUrl)
    assert.strictEqual(url.origin + url.pathname, 'https://claude.ai/oauth/authorize')
    assert.strictEqual(url.searchParams.get('client_id'), '9d1c250a-e61b-44d9-88ed-5944d1962f5e')
    assert.strictEqual(url.searchParams.get('response_type'), 'code')
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256')
    assert.strictEqual(url.searchParams.get('code_challenge').length, 43)
    assert.ok(url.searchParams.get('state').length >= 16)
    assert.ok(!url.searchParams.get('scope').includes('org:create_api_key'))
    const redirect = new URL(url.searchParams.get('redirect_uri'))
    assert.strictEqual(redirect.pathname, '/callback')

    // A plain browser navigation (not the JSON fetch) is redirected straight to the authorization page.
    const nav = await call('/api/dsh-anthropic-oauth/login', { accept: 'text/html' })
    assert.strictEqual(nav.statusCode, 302)
    assert.strictEqual(nav.headers.location, authUrl)

    // The loopback callback server is really listening, and rejects a forged state.
    const forged = await fetch(`http://127.0.0.1:${redirect.port}/callback?code=x&state=forged`)
    assert.strictEqual(forged.status, 400)
  } finally {
    for (const dispose of disposers) dispose()
    fs.rmSync(tmp, { recursive: true, force: true })
    delete process.env.DSH_HOME
    delete process.env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR
  }
})

test('client module loads in the browser module loader and registers its slots', async () => {
  let loaded
  globalThis.window = { __ModuleLoader__: { load: (module) => { loaded = module } } }
  await import('../lib/client.js')
  assert.strictEqual(loaded.id, 'dsh-anthropic-oauth')
  const mod = loaded.factory(() => ({ createElement: () => ({}) }))
  assert.strictEqual(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject))
  const slots = []
  const fakeSlots = { inject: (slot, make) => { slots.push(slot); make() }, register: () => () => {} }
  // ctx.inject hands the callback the services once they exist, as in DSH.
  mod.apply({ slots: fakeSlots, inject: (names, fn) => { assert.ok(names.includes('modelDirectories')); fn({ slots: fakeSlots, modelDirectories: {} }) } })
  assert.deepStrictEqual(slots.sort(), ['conversation.composer.dock', 'conversation.input.right', 'settings.section'])
  delete globalThis.window
})

test('credential paths honor isolation overrides instead of the real home', () => {
  const isolated = { DSH_HOME: '/tmp/iso-dsh', DSH_ANTHROPIC_OAUTH_CLAUDE_DIR: '/tmp/iso-claude' }
  assert.strictEqual(claudeCredsFile(isolated), '/tmp/iso-claude/.credentials.json')
  assert.strictEqual(dshHome(isolated), '/tmp/iso-dsh')
  assert.strictEqual(connectionFile(isolated), '/tmp/iso-dsh/dsh-anthropic-oauth/connection.json')
  assert.strictEqual(claudeCredsFile({ CLAUDE_CONFIG_DIR: '/tmp/cc' }), '/tmp/cc/.credentials.json')
  assert.ok(claudeCredsFile({}).endsWith('/.claude/.credentials.json'))
})

test('plugin metadata', () => {
  assert.strictEqual(name, 'dsh-anthropic-oauth')
  assert.ok(Array.isArray(inject))
  assert.ok(inject.includes('credentials'))
  assert.ok(inject.includes('settings'))
})

test('client id resolution', () => {
  const id = getClientId()
  assert.strictEqual(id, '9d1c250a-e61b-44d9-88ed-5944d1962f5e')
})

test('claude code version discovery', async () => {
  const v = await getClaudeCodeVersion()
  assert.ok(typeof v === 'string')
  assert.ok(/^\d+\.\d+/.test(v))
})

test('claude code request headers', async () => {
  const token = 'sk-ant-test-token-12345'
  const betas = ['oauth-2025-04-20', 'claude-code-20250219']
  const headers = await claudeCodeHeaders(token, betas)

  assert.strictEqual(headers.authorization, `Bearer ${token}`)
  assert.strictEqual(headers['anthropic-version'], '2023-06-01')
  assert.strictEqual(headers['anthropic-beta'], 'oauth-2025-04-20,claude-code-20250219')
  assert.strictEqual(headers['anthropic-dangerous-direct-browser-access'], 'true')
  assert.ok(headers['user-agent'].startsWith('claude-cli/'))
})

test('pkce verifier and challenge generation', () => {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

  assert.strictEqual(verifier.length, 43)
  assert.strictEqual(challenge.length, 43)
  assert.ok(!verifier.includes('+') && !verifier.includes('/') && !verifier.includes('='))
  assert.ok(!challenge.includes('+') && !challenge.includes('/') && !challenge.includes('='))
})


test('callback response escapes untrusted error and profile markup', () => {
  assert.strictEqual(escapeHtml('<img src=x onerror="alert(1)">&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;')
  assert.strictEqual(escapeHtml("O'Reilly"), 'O&#39;Reilly')
  assert.strictEqual(escapeHtml(null), '')
  assert.strictEqual(escapeHtml('normal@example.com'), 'normal@example.com')
})

test('scopes enforce least privilege without org api key creation', () => {
  assert.ok(!CLAUDE_SCOPE.includes('org:create_api_key'), 'Must not request org:create_api_key scope')
  assert.ok(CLAUDE_SCOPE.includes('user:profile'))
  assert.ok(CLAUDE_SCOPE.includes('user:inference'))
})
