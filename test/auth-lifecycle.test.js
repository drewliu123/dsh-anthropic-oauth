import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { apply, CLAUDE_SCOPE } from '../lib/index.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const SECRET = 'private-access-and-refresh-token-do-not-display'
const tokenResponse = () => Response.json({ access_token: SECRET, refresh_token: 'refresh-secret', expires_in: 3600 })

async function fixture(run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aoauth-lifecycle-'))
  const previous = { DSH_HOME: process.env.DSH_HOME, DSH_ANTHROPIC_OAUTH_CLAUDE_DIR: process.env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR }
  process.env.DSH_HOME = tmp
  process.env.DSH_ANTHROPIC_OAUTH_CLAUDE_DIR = path.join(tmp, 'claude')
  const credentialFile = path.join(tmp, 'claude', '.credentials.json')
  const connectionFile = path.join(tmp, 'dsh-anthropic-oauth', 'connection.json')
  const realFetch = globalThis.fetch
  const routes = new Map(), disposers = [], stored = new Map()
  const f = {
    stored, credentialFile, connectionFile,
    network: async () => Response.json({}),
    set: async (key, value) => { stored.set(key, value) },
    unset: async key => { stored.delete(key) },
    async call(route, method = 'POST') {
      const response = { statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v }, end(body = '') { this.body = body } }
      await routes.get(`/api/dsh-anthropic-oauth/${route}`)({ method, headers: { accept: 'application/json' }, url: `/api/dsh-anthropic-oauth/${route}` }, response)
      return { status: response.statusCode, ...JSON.parse(response.body) }
    },
    async login() {
      const result = await f.call('login', 'GET')
      assert.equal(result.ok, true)
      const authorization = new URL(result.authUrl)
      const callback = new URL(authorization.searchParams.get('redirect_uri'))
      callback.hostname = '127.0.0.1'
      callback.searchParams.set('state', authorization.searchParams.get('state'))
      callback.searchParams.set('code', 'mock-code')
      return { authorization, callback, send: () => realFetch(callback) }
    },
    seed(expiry = Date.now() + 864e5) {
      fs.mkdirSync(path.dirname(credentialFile), { recursive: true })
      fs.writeFileSync(credentialFile, JSON.stringify({ claudeAiOauth: { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: expiry } }))
    },
  }
  globalThis.fetch = (url, init) => f.network(String(url), init)
  apply({
    get(name) {
      if (name === 'webServer') return { register(route) { routes.set(route.path, route.handler); return () => {} } }
      if (name === 'credentials') return { set: (key, value) => f.set(key, value), unset: key => f.unset(key) }
      if (name === 'settings') return { get: () => ({}), update: async () => {} }
    },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
  })
  try { await run(f) } finally {
    for (const dispose of disposers) dispose()
    globalThis.fetch = realFetch
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

test('settings Cancel invokes the host cancellation endpoint with POST', async () => {
  let loaded, settingsRenderer, stateIndex = 0
  const calls = [], changed = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const index = stateIndex++; return [index === 2 ? true : typeof initial === 'function' ? initial() : initial, value => changed.push([index, value])] },
    useRef: value => ({ current: value }),
    useCallback: fn => fn,
    useEffect() {},
  }
  const settled = deferred()
  vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { loaded = value } } },
    fetch: async (url, init) => {
      calls.push([url, init?.method || 'GET'])
      if (url.endsWith('/status')) settled.resolve()
      return { ok: true, json: async () => ({ ok: true, authenticated: false }) }
    },
  })
  const client = loaded.factory(() => React)
  client.apply({ slots: { inject: (slot, make) => make(), register: (options, render) => { settingsRenderer = render } }, inject() {} })
  const tree = settingsRenderer({}).type()
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const cancel = walk(tree).find(node => node.type === 'button' && node.children.includes('Cancel'))
  assert.ok(cancel)
  cancel.props.onClick()
  await settled.promise
  assert.deepEqual(calls[0], ['/api/dsh-anthropic-oauth/cancel', 'POST'])
  assert.ok(changed.some(([index, value]) => index === 2 && value === false))
})

const successfulNetwork = async url => {
  if (url.includes('/v1/oauth/token')) return tokenResponse()
  if (url.includes('/profile')) return Response.json({ email: 'mock@example.invalid' })
  if (url.includes('/v1/models')) return Response.json({ data: [{ id: 'mock-model', display_name: 'Mock' }] })
  return Response.json({})
}

test('cancel aborts an exchange; an abort-ignoring late response cannot restore tokens or close a new login', async () => fixture(async f => {
  const entered = deferred(), release = deferred()
  let signal
  f.network = async (url, init) => {
    if (url.includes('/v1/oauth/token')) { signal = init.signal; entered.resolve(); await release.promise; return tokenResponse() }
    return successfulNetwork(url)
  }
  const oldFlow = await f.login()
  const oldCallback = oldFlow.send()
  await entered.promise
  assert.equal((await f.call('cancel', 'GET')).status, 405)
  assert.equal(signal.aborted, false)
  assert.equal((await f.call('cancel')).ok, true)
  assert.equal(signal.aborted, true)
  const nextFlow = await f.login()
  assert.notEqual(nextFlow.authorization.searchParams.get('state'), oldFlow.authorization.searchParams.get('state'))
  release.resolve()
  assert.equal((await oldCallback).status, 500)
  assert.equal(f.stored.size, 0)
  assert.equal(fs.existsSync(f.credentialFile), false)
  assert.equal(fs.existsSync(f.connectionFile), false)
  f.network = successfulNetwork
  assert.equal((await nextFlow.send()).status, 200)
  assert.equal((await f.call('status', 'GET')).authenticated, true)
  assert.equal(f.stored.get('ANTHROPIC_OAUTH_TOKEN'), SECRET)
  const saved = JSON.parse(fs.readFileSync(f.credentialFile, 'utf8')).claudeAiOauth
  assert.deepEqual(saved.scopes, CLAUDE_SCOPE.split(/\s+/).filter(Boolean))
  assert.equal(fs.statSync(f.credentialFile).mode & 0o777, 0o600)
}))

test('callback verifies state before processing errors and never echoes provider errors or token bodies', async () => fixture(async f => {
  const flow = await f.login()
  const forged = new URL(flow.callback)
  forged.searchParams.set('state', 'forged')
  forged.searchParams.set('error', SECRET)
  const denied = await fetchLoopback(forged)
  assert.equal(denied.status, 400)
  assert.match(await denied.text(), /State mismatch/)
  f.network = async () => Response.json({ error: SECRET, error_description: SECRET, access_token: SECRET }, { status: 400 })
  const exchange = await flow.send()
  assert.equal(exchange.status, 500)
  assert.ok(!(await exchange.text()).includes(SECRET))
  const next = await f.login()
  const rejected = new URL(next.callback)
  rejected.searchParams.set('error', SECRET)
  const response = await fetchLoopback(rejected)
  assert.equal(response.status, 400)
  assert.ok(!(await response.text()).includes(SECRET))
}))

// Loopback traffic bypasses the mocked upstream fetch.
const fetchLoopback = async url => {
  const http = await import('node:http')
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })))
    }).on('error', reject)
  })
}

test('logout waits for an in-flight credential write and removes both refs after it settles', async () => fixture(async f => {
  f.network = successfulNetwork
  const entered = deferred(), release = deferred()
  f.set = async (key, value) => { entered.resolve(); await release.promise; f.stored.set(key, value) }
  const flow = await f.login()
  const callback = flow.send()
  await entered.promise
  assert.equal((await f.call('logout', 'GET')).status, 405)
  const disconnect = f.call('logout')
  assert.equal(fs.existsSync(f.connectionFile), false)
  release.resolve()
  assert.equal((await disconnect).ok, true)
  await callback
  assert.equal(f.stored.size, 0)
  assert.equal((await f.call('status', 'GET')).authenticated, false)
  assert.equal(fs.existsSync(f.connectionFile), false)
}))

test('cancel clears absent credential references using the real unset API', async () => fixture(async f => {
  const cleared = []
  f.unset = async key => { cleared.push(key); f.stored.delete(key) }
  const result = await f.call('cancel')
  assert.equal(result.ok, true)
  assert.deepEqual(cleared.sort(), ['ANTHROPIC_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
  assert.equal(fs.existsSync(f.credentialFile), false)
}))

test('credential cleanup failure is reported and a retry can clear both refs', async () => fixture(async f => {
  f.stored.set('ANTHROPIC_OAUTH_TOKEN', SECRET)
  f.stored.set('CLAUDE_CODE_OAUTH_TOKEN', SECRET)
  const cleared = []
  f.unset = async key => { cleared.push(key); if (key === 'ANTHROPIC_OAUTH_TOKEN') throw new Error(SECRET); f.stored.delete(key) }
  const failed = await f.call('cancel')
  assert.equal(failed.status, 500)
  assert.equal(failed.ok, false)
  assert.ok(!JSON.stringify(failed).includes(SECRET))
  assert.equal(cleared.length, 2)
  f.unset = async key => { f.stored.delete(key) }
  assert.equal((await f.call('cancel')).ok, true)
  assert.equal(f.stored.size, 0)
}))

test('disconnect during adoption refresh prevents late shared-file and DSH writes', async () => fixture(async f => {
  f.seed(1)
  const before = fs.readFileSync(f.credentialFile, 'utf8')
  const entered = deferred(), release = deferred()
  let signal
  f.network = async (url, init) => {
    if (url.includes('/v1/oauth/token')) { signal = init.signal; entered.resolve(); await release.promise; return tokenResponse() }
    return successfulNetwork(url)
  }
  const adopting = f.call('adopt')
  await entered.promise
  await f.call('logout')
  assert.equal(signal.aborted, true)
  release.resolve()
  assert.equal((await adopting).ok, false)
  assert.equal(fs.readFileSync(f.credentialFile, 'utf8'), before)
  assert.equal(fs.existsSync(f.connectionFile), false)
  assert.equal(f.stored.size, 0)
  assert.equal((await f.call('status', 'GET')).authenticated, false)
}))

test('concurrent adoption, sync and quota reads share one token refresh', async () => fixture(async f => {
  f.seed(1)
  const entered = deferred(), release = deferred()
  let refreshCount = 0
  f.network = async url => {
    if (url.includes('/v1/oauth/token')) {
      refreshCount++
      entered.resolve()
      await release.promise
      return tokenResponse()
    }
    return successfulNetwork(url)
  }
  const adopting = f.call('adopt')
  await entered.promise
  const syncing = f.call('sync')
  const quota = f.call('quota', 'GET')
  // Let the handlers reach their shared pending refresh before releasing it.
  await new Promise(resolve => setImmediate(resolve))
  release.resolve()
  const [adopted, synced] = await Promise.all([adopting, syncing, quota])
  assert.equal(refreshCount, 1)
  assert.equal(adopted.ok, true)
  assert.equal(synced.ok, true)
  assert.equal(f.stored.get('ANTHROPIC_OAUTH_TOKEN'), SECRET)
  assert.equal(fs.statSync(f.credentialFile).mode & 0o777, 0o600)
}))

test('refresh failures redact upstream bodies, malformed JSON and thrown network secrets', async () => fixture(async f => {
  f.seed(1)
  for (const mode of ['body', 'json', 'network']) {
    f.network = async () => {
      if (mode === 'network') throw new Error(SECRET)
      return mode === 'json' ? new Response(SECRET) : Response.json({ error: SECRET, refresh_token: SECRET }, { status: 400 })
    }
    const adopt = await f.call('adopt')
    assert.equal(adopt.ok, false)
    assert.ok(!JSON.stringify(adopt).includes(SECRET))
    assert.ok(!JSON.stringify(await f.call('status', 'GET')).includes(SECRET))
    assert.ok(!JSON.stringify(await f.call('quota', 'GET')).includes(SECRET))
    await f.call('logout')
  }
}))
