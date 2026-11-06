import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { main } from '../bin/claude-oauth-login.mjs'

const logger = { log() {} }

function isolated(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-test-'))
  t.after(() => {
    assert.equal(fs.realpathSync(path.dirname(root)), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('claude-cli-test-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { root, env: { DSH_HOME: path.join(root, 'dsh'), DSH_ANTHROPIC_OAUTH_CLAUDE_DIR: path.join(root, 'claude') } }
}

// Exercise the real callback listener without a browser or Anthropic requests.
async function callbackLogin(params, options = {}) {
  let authUrl
  let callbackDone
  let callbackFailed
  const responsePromise = new Promise((resolve, reject) => { callbackDone = resolve; callbackFailed = reject })
  const requests = []
  const login = main({
    logger,
    fetch: async (url, init) => {
      requests.push({ url, init })
      return { ok: true, json: async () => url.endsWith('/token')
        ? { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 }
        : { email: 'test@example.com', subscription_type: 'max' } }
    },
    ...options,
    openBrowser(url) {
      authUrl = new URL(url)
      const redirect = new URL(authUrl.searchParams.get('redirect_uri'))
      redirect.hostname = '127.0.0.1'
      const values = { state: authUrl.searchParams.get('state'), ...params }
      for (const [key, value] of Object.entries(values)) if (value !== undefined) redirect.searchParams.set(key, value)
      fetch(redirect).then(async (response) => callbackDone({ status: response.status, body: await response.text() })).catch(callbackFailed)
    },
  })
  // Observe rejection immediately: the listener may reject before HTTP finishes.
  const outcomePromise = login.then(() => null, (error) => error)
  const [response, error] = await Promise.all([responsePromise, outcomePromise])
  return { response, error, authUrl, requests }
}

test('CLI import has no browser, listener, or output side effects', () => {
  const url = new URL('../bin/claude-oauth-login.mjs', import.meta.url).href
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import http from 'node:http';
    import cp from 'node:child_process';
    http.createServer = () => { throw new Error('unexpected listener') };
    cp.exec = () => { throw new Error('unexpected browser') };
    await import(${JSON.stringify(url)});
    console.log('imported');
  `], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stdout.trim(), 'imported')
})

test('CLI runs through an installed bin symlink and reports listen errors with exit 1', (t) => {
  const { root } = isolated(t)
  const entry = path.join(root, 'anthropic-oauth-login')
  fs.symlinkSync(new URL('../bin/claude-oauth-login.mjs', import.meta.url), entry)
  const preload = 'data:text/javascript,' + encodeURIComponent(`
    import http from 'node:http';
    http.createServer = () => { throw new Error('test listen failure') };
  `)
  const child = spawnSync(process.execPath, ['--import', preload, entry], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 1)
  assert.match(child.stderr, /\[ERROR\] Login failed: test listen failure/)
})

for (const existing of [false, true]) {
  test(`login honors isolation, preserves other credentials, and enforces 0600 (${existing ? 'existing' : 'new'} Claude store)`, async (t) => {
    const { env } = isolated(t)
    const claudeFile = path.join(env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR, '.credentials.json')
    const dshFile = path.join(env.DSH_HOME, '.credentials.yaml')
    fs.mkdirSync(env.DSH_HOME, { recursive: true })
    fs.writeFileSync(dshFile, 'refs:\n  OTHER: keep\n  ANTHROPIC_OAUTH_TOKEN: old\n', { mode: 0o644 })
    if (existing) {
      fs.mkdirSync(path.dirname(claudeFile), { recursive: true })
      fs.writeFileSync(claudeFile, JSON.stringify({ otherCredential: 'keep' }), { mode: 0o644 })
    }
    env.CLAUDE_CONFIG_DIR = path.join(env.DSH_HOME, 'unused-fallback')
    env.CLAUDE_OAUTH_SCOPES = ' user:profile   user:inference user:custom '
    const result = await callbackLogin({ code: 'test-code' }, { env })
    assert.equal(result.error, null)
    assert.equal(result.response.status, 200)
    const creds = JSON.parse(fs.readFileSync(claudeFile, 'utf8'))
    assert.equal(creds.claudeAiOauth.accessToken, 'test-access')
    assert.equal(creds.claudeAiOauth.refreshToken, 'test-refresh')
    assert.equal(creds.claudeAiOauth.emailAddress, 'test@example.com')
    assert.deepEqual(creds.claudeAiOauth.scopes, ['user:profile', 'user:inference', 'user:custom'])
    assert.equal(result.authUrl.searchParams.get('scope'), creds.claudeAiOauth.scopes.join(' '))
    assert.equal(result.authUrl.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(result.authUrl.searchParams.get('code_challenge').length, 43)
    if (existing) assert.equal(creds.otherCredential, 'keep')
    const yaml = fs.readFileSync(dshFile, 'utf8')
    assert.match(yaml, /OTHER: keep/)
    assert.match(yaml, /ANTHROPIC_OAUTH_TOKEN: test-access/)
    assert.match(yaml, /CLAUDE_CODE_OAUTH_TOKEN: test-access/)
    assert.equal(fs.statSync(claudeFile).mode & 0o777, 0o600)
    assert.equal(fs.statSync(dshFile).mode & 0o777, 0o600)
    assert.equal(fs.existsSync(env.CLAUDE_CONFIG_DIR), false)
    const exchange = JSON.parse(result.requests[0].init.body)
    assert.equal(exchange.code, 'test-code')
    assert.equal(exchange.state, result.authUrl.searchParams.get('state'))
    assert.equal(exchange.redirect_uri, result.authUrl.searchParams.get('redirect_uri'))
  })
}

test('Claude Code fallback directory and default requested scopes are honored', async (t) => {
  const { root, env } = isolated(t)
  delete env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR
  env.CLAUDE_CONFIG_DIR = path.join(root, 'claude-code')
  const result = await callbackLogin({ code: 'test-code' }, { env })
  assert.equal(result.error, null)
  const creds = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'), 'utf8'))
  assert.deepEqual(creds.claudeAiOauth.scopes, ['user:profile', 'user:inference'])
  assert.equal(fs.existsSync(env.DSH_HOME), false)
})

for (const params of [
  { state: 'forged', error: '<script>bad</script>', code: 'code' },
  { state: undefined, error: '<script>bad</script>' },
]) {
  test(`callback validates ${params.state ? 'forged' : 'missing'} state before handling OAuth errors`, async (t) => {
    const { env } = isolated(t)
    const result = await callbackLogin(params, { env })
    assert.equal(result.response.status, 400)
    assert.match(result.response.body, /State mismatch/)
    assert.doesNotMatch(result.response.body, /script|bad/)
    assert.equal(result.error.message, 'State mismatch')
    assert.equal(result.requests.length, 0)
    assert.equal(fs.existsSync(env.DSH_HOME), false)
  })
}

test('authenticated OAuth error is escaped in callback HTML', async (t) => {
  const { env } = isolated(t)
  const error = `<img src=x onerror="bad()">&'`
  const result = await callbackLogin({ error }, { env })
  assert.equal(result.response.status, 400)
  assert.equal(result.error.message, error)
  assert.match(result.response.body, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;&amp;&#39;/)
  assert.doesNotMatch(result.response.body, /<img/)
  assert.equal(result.requests.length, 0)
})

for (const code of [undefined, '', '   ']) {
  test(`callback rejects ${JSON.stringify(code) ?? 'missing'} authorization code without token exchange`, async (t) => {
    const { env } = isolated(t)
    const result = await callbackLogin({ code }, { env })
    assert.equal(result.response.status, 400)
    assert.match(result.error.message, /Missing authorization code/)
    assert.equal(result.requests.length, 0)
    assert.equal(fs.existsSync(env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR), false)
  })
}

test('IPv6 asynchronous listen failure leaves IPv4 login working', async (t) => {
  const { env } = isolated(t)
  let count = 0
  let ipv6Closed = false
  const result = await callbackLogin({ code: 'code' }, {
    env,
    createServer(handler) {
      if (++count === 1) return http.createServer(handler)
      const server = new EventEmitter()
      server.listen = () => { process.nextTick(() => server.emit('error', new Error('IPv6 unavailable'))); return server }
      server.close = () => { ipv6Closed = true }
      return server
    },
  })
  assert.equal(result.error, null)
  assert.equal(result.response.status, 200)
  assert.equal(ipv6Closed, true)
})

for (const synchronous of [false, true]) {
  test(`IPv4 ${synchronous ? 'synchronous' : 'asynchronous'} listen failure rejects and cleans up`, async (t) => {
    const { env } = isolated(t)
    let closed = false
    const error = new Error('IPv4 unavailable')
    await assert.rejects(main({
      env, logger,
      openBrowser() { assert.fail('browser must not open') },
      createServer() {
        const server = new EventEmitter()
        server.listen = () => {
          if (synchronous) throw error
          process.nextTick(() => server.emit('error', error))
        }
        server.close = () => { closed = true }
        return server
      },
    }), error)
    assert.equal(closed, true)
  })
}
