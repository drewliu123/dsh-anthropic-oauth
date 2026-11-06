import { test } from 'node:test'
import assert from 'node:assert'

async function loadHelpers() {
  let loaded
  globalThis.window = { __ModuleLoader__: { load: (module) => { loaded = module } } }
  await import(`../lib/client.js?helpers=${Math.random()}`)
  const mod = loaded.factory(() => ({ createElement: () => ({}) }))
  delete globalThis.window
  return mod.helpers
}

test('quota colour steps follow remaining capacity', async () => {
  const { quotaStep } = await loadHelpers()
  assert.strictEqual(quotaStep(100), 'good')
  assert.strictEqual(quotaStep(60), 'good')
  assert.strictEqual(quotaStep(59), 'ok')
  assert.strictEqual(quotaStep(40), 'ok')
  assert.strictEqual(quotaStep(39), 'low')
  assert.strictEqual(quotaStep(20), 'low')
  assert.strictEqual(quotaStep(19), 'critical')
  assert.strictEqual(quotaStep(0), 'critical')
})

test('windows are read defensively and the tightest primary window wins', async () => {
  const { collectWindows, tightestWindow } = await loadHelpers()
  const data = {
    fiveHour: { utilization: 0.42, status: 'allowed', reset: 1800000000 },
    sevenDay: { utilization: 0.83, status: 'allowed_warning', reset: 1800500000 },
    extra: [{ id: 'seven_day_opus', utilization: 0.99, status: 'allowed_warning', reset: null }],
  }
  const windows = collectWindows(data)
  assert.deepStrictEqual(windows.map((w) => [w.id, w.remaining, w.used]), [['five_hour', 58, 42], ['seven_day', 17, 83], ['seven_day_opus', 1, 99]])
  assert.strictEqual(windows[2].label, '7-day · Opus')
  // The Opus-only bucket is nearly empty but must not decide the composer colour.
  assert.strictEqual(tightestWindow(windows).id, 'seven_day')

  // Exhausted or rejected windows read as zero, never negative; garbage is dropped.
  assert.strictEqual(collectWindows({ fiveHour: { utilization: 1, status: 'rejected' } })[0].remaining, 0)
  assert.strictEqual(collectWindows({ fiveHour: { utilization: 1.7 } })[0].remaining, 0)
  assert.deepStrictEqual(collectWindows({ fiveHour: { utilization: 'x' }, sevenDay: null }), [])
  assert.deepStrictEqual(collectWindows(null), [])
  assert.strictEqual(tightestWindow([]), null)
})

test('reset countdowns switch units and handle the past', async () => {
  const { timeLeft, resetLine } = await loadHelpers()
  const now = Date.UTC(2026, 9, 28, 12, 0, 0)
  assert.strictEqual(timeLeft(now / 1000 + 3 * 86400 + 4 * 3600, now), '3d 4h')
  assert.strictEqual(timeLeft(now / 1000 + 2 * 3600 + 13 * 60, now), '2h 13m')
  assert.strictEqual(timeLeft(now / 1000 + 5 * 60, now), '5m')
  assert.strictEqual(timeLeft(now / 1000 - 10, now), null)
  assert.strictEqual(resetLine(null), 'Reset time unavailable')
  assert.strictEqual(resetLine(1), 'Resetting now')
})

test('models are grouped by family, newest-first order kept, and searchable', async () => {
  const { groupModels, familyOf, formatTokens, prettyTier } = await loadHelpers()
  const models = [
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'claude-mystery', name: 'Mystery' },
  ]
  assert.deepStrictEqual(groupModels(models, '').map((g) => [g.family, g.models.map((m) => m.id)]), [
    ['opus', ['claude-opus-4-5']], ['sonnet', ['claude-sonnet-4-5', 'claude-sonnet-4']], ['haiku', ['claude-haiku-4-5']], ['other', ['claude-mystery']],
  ])
  assert.deepStrictEqual(groupModels(models, ' SONNET ').map((g) => g.family), ['sonnet'])
  assert.deepStrictEqual(groupModels(models, 'zzz'), [])
  assert.strictEqual(familyOf({ id: 'x', name: 'Opus Next' }), 'opus')
  assert.strictEqual(formatTokens(1000000), '1M')
  assert.strictEqual(formatTokens(200000), '200k')
  assert.strictEqual(prettyTier('default_claude_max_5x'), 'Max 5x')
})
