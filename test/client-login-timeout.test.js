import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const START = Date.UTC(2026, 10, 6, 16)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

// Execute the real settings component with persistent hooks and a local clock; no browser or network.
function fixture({ expiresAt = START + 10 * 60_000, lang = 'en', cancelError = false } = {}) {
  let loaded, settingsRenderer, now = START, nextTimer = 0, tree
  let stateIndex, refIndex, effectIndex, callbackIndex
  const states = [], refs = [], effects = [], callbacks = [], timers = new Map(), listeners = new Map(), calls = []
  let request = async url => {
    if (url.endsWith('/login')) return { ok: true, authUrl: 'https://example.invalid/consent', expiresAt }
    if (url.endsWith('/cancel') && cancelError) throw new Error('Cleanup failed')
    return { ok: true, authenticated: false }
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = stateIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef(initial) { const index = refIndex++; return refs[index] || (refs[index] = { current: initial }) },
    useCallback(fn, deps) {
      const index = callbackIndex++, previous = callbacks[index]
      if (previous && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return previous.fn
      callbacks[index] = { fn, deps }
      return fn
    },
    useEffect(fn, deps) {
      const index = effectIndex++, previous = effects[index]
      if (previous && deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      previous?.cleanup?.()
      effects[index] = { deps, pending: fn }
    },
  }
  const schedule = (fn, delay, interval) => { const id = ++nextTimer; timers.set(id, { fn, due: now + delay, interval }); return id }
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: { load: value => { loaded = value } },
      open: () => ({ location: {}, close() {} }),
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) },
      dispatchEvent() {},
    },
    document: { documentElement: { lang }, querySelector: () => true },
    localStorage: { getItem: () => null },
    Event: class {}, Date: FakeDate,
    fetch: async (url, options) => { calls.push([url, options?.method || 'GET']); const value = await request(url, options); return { ok: true, json: async () => value } },
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: id => timers.delete(id),
  })
  const client = loaded.factory(() => React)
  client.apply({ slots: { inject: (slot, make) => make(), register: (options, render) => { settingsRenderer = render } }, inject() {} })
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => {
    stateIndex = refIndex = effectIndex = callbackIndex = 0
    tree = settingsRenderer({}).type()
    for (const effect of effects) if (effect.pending) { const fn = effect.pending; delete effect.pending; effect.cleanup = fn() }
    return tree
  }
  const text = () => {
    const collect = node => typeof node === 'string' ? node : node?.children ? node.children.flat(Infinity).map(collect).join(' ') : ''
    return collect(tree)
  }
  return {
    helpers: client.helpers, states, calls, render, text,
    setRequest: fn => { request = fn },
    async start() { render(); await settle(); render(); await walk(tree).find(node => node.children.includes(lang === 'en' ? 'Sign in' : '登录')).props.onClick(); render(); await settle() },
    async click(label) { const node = walk(tree).find(node => node.children.includes(label) && node.props.onClick); assert.ok(node, label); await node.props.onClick(); await settle(); render() },
    async advance(ms) {
      const target = now + ms
      while (true) {
        const next = [...timers.entries()].filter(([, value]) => value.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        const [id, timer] = next
        now = timer.due
        if (timer.interval) timer.due += timer.interval; else timers.delete(id)
        await timer.fn(); await settle(); render()
      }
      now = target; render()
    },
    async focusAt(time) { now = time; listeners.get('focus')?.(); await settle(); render() },
    dispose() { for (const effect of effects) effect.cleanup?.() },
  }
}

test('server deadline drives the real waiting banner and timeout beyond the former three minutes', async () => {
  const f = fixture()
  try {
    await f.start()
    assert.equal(f.states[2], true) // Keep the existing loginPending hook index stable.
    assert.equal(f.states[7], START + 10 * 60_000)
    assert.match(f.text(), /Sign-in expires at/)
    await f.advance(3 * 60_000)
    assert.equal(f.states[2], true)
    assert.equal(f.calls.filter(([url]) => url.endsWith('/cancel')).length, 0)
    await f.advance(7 * 60_000)
    assert.equal(f.states[2], false)
    assert.equal(f.states[7], null)
    assert.match(f.text(), /expired.*Start a fresh login and close the old authorization tab/)
    assert.deepEqual(f.calls.filter(([url]) => url.endsWith('/cancel')), [['/api/dsh-anthropic-oauth/cancel', 'POST']])
  } finally { f.dispose() }
})

test('missing or invalid server deadlines use fifteen minutes, while past deadlines stay expired', async () => {
  const f = fixture({ expiresAt: null })
  try {
    for (const value of [null, undefined, 0, -1, NaN, Infinity, 'invalid']) assert.equal(f.helpers.loginDeadline(value, START), START + 15 * 60_000)
    assert.equal(f.helpers.loginDeadline(START - 1, START), START - 1)
    await f.start()
    await f.advance(15 * 60_000 - 1)
    assert.equal(f.states[2], true)
    await f.advance(1)
    assert.equal(f.states[2], false)
  } finally { f.dispose() }
})

test('focus detects expiry and cancellation failure preserves useful instructions in both languages', async () => {
  for (const lang of ['en', 'zh-CN']) {
    const f = fixture({ lang, cancelError: true })
    try {
      await f.start()
      await f.focusAt(START + 11 * 60_000)
      assert.equal(f.states[1], false)
      assert.equal(f.states[2], false)
      assert.match(f.text(), lang === 'en' ? /Start a fresh login and close the old authorization tab/ : /重新发起登录，并关闭旧的授权标签页/)
      assert.doesNotMatch(f.text(), /Cleanup failed|Could not cancel|无法取消/)
    } finally { f.dispose() }
  }
})

test('late successful status cannot reconnect an expired login', async () => {
  const f = fixture()
  try {
    await f.start()
    const late = deferred()
    f.setRequest(async url => url.endsWith('/status') ? late.promise : { ok: true })
    // Capture an in-flight poll without waiting on it, then simulate returning to a sleeping tab.
    const polling = f.advance(2000)
    await settle()
    await f.focusAt(START + 11 * 60_000)
    late.resolve({ ok: true, authenticated: true, email: 'late@example.invalid' })
    await polling
    assert.equal(f.states[0].authenticated, false)
    assert.equal(f.states[7], null)
    assert.match(f.text(), /This sign-in expired/)
  } finally { f.dispose() }
})

test('success and explicit cancellation clear the deadline', async () => {
  const f = fixture()
  try {
    await f.start()
    f.setRequest(async url => ({ ok: true, authenticated: url.endsWith('/status') }))
    await f.advance(2000)
    assert.equal(f.states[0].authenticated, true)
    assert.equal(f.states[2], false)
    assert.equal(f.states[7], null)
    await f.click('Disconnect')
    await f.click('Disconnect')
    assert.equal(f.states[7], null)
  } finally { f.dispose() }
  const cancelled = fixture()
  try {
    await cancelled.start()
    await cancelled.click('Cancel')
    assert.equal(cancelled.states[7], null)
    assert.equal(cancelled.states[2], false)
    await cancelled.advance(20 * 60_000)
    assert.doesNotMatch(cancelled.text(), /expired/)
  } finally { cancelled.dispose() }
})
