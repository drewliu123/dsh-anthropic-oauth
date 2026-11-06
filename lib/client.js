/**
 * dsh-anthropic-oauth client UI for DeepSeek Harness.
 *
 * Self-contained: uses DSH slots and theme tokens, never reads credential values, and keeps all
 * OAuth work on the host side. Derived from grloper/dsh-claude-oauth (MIT); the presentation layer is original.
 * Quota and model-selection UX follows the structure of dsh-codex (compact composer meter, per-window
 * quota cards, per-model enable switches).
 */

window.__ModuleLoader__.load({
  id: 'dsh-anthropic-oauth',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    const name = 'anthropic-oauth'
    const inject = ['slots']
    const PROVIDER = 'anthropic'
    const BASE = '/api/dsh-anthropic-oauth'
    const STATUS_URL = `${BASE}/status`
    const LOGIN_URL = `${BASE}/login`
    const SYNC_URL = `${BASE}/sync`
    const ADOPT_URL = `${BASE}/adopt`
    const LOGOUT_URL = `${BASE}/logout`
    const QUOTA_URL = `${BASE}/quota`
    const MODELS_URL = `${BASE}/models`
    const CSS_ID = 'dsh-anthropic-oauth/styles'
    const POLL_MS = 60000

    const CSS = `
      .dco-shell,.dco-toolbar,.dco-dock{--dco-accent:#d97706;--dco-accent-2:#f59e0b;--dco-good:var(--dsw-alias-state-success-primary,#22c55e);--dco-ok:#eab308;--dco-low:#f97316;--dco-critical:var(--dsw-alias-state-error-primary,#ef4444)}
      .dco-shell{display:flex;flex-direction:column;gap:16px;max-width:720px;padding:4px 0 28px;color:var(--dsw-alias-label-primary,#f4f4f5)}
      .dco-hero{position:relative;overflow:hidden;display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--dco-accent) 13%,var(--dsw-specific-card-fill,#18181c)),var(--dsw-specific-card-fill,#18181c) 66%);box-shadow:0 14px 34px rgba(0,0,0,.12)}
      .dco-hero:after{content:'';position:absolute;right:-55px;top:-85px;width:210px;height:210px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--dco-accent-2) 22%,transparent),transparent 68%);pointer-events:none}
      .dco-hero-copy{position:relative;z-index:1;display:flex;flex:1 1 300px;gap:14px;min-width:0}
      .dco-mark{display:flex;align-items:center;justify-content:center;flex:none;width:42px;height:42px;border-radius:13px;background:linear-gradient(145deg,var(--dco-accent-2),var(--dco-accent));color:#fff;box-shadow:0 8px 18px color-mix(in srgb,var(--dco-accent) 35%,transparent)}
      .dco-mark svg{width:25px;height:25px}
      .dco-hero h2{margin:0;font-size:20px;line-height:1.2;letter-spacing:-.02em}
      .dco-kicker{margin:5px 0 0;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:13px;line-height:1.45;max-width:470px}
      .dco-hero-actions{position:relative;z-index:1;display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:0 1 auto}
      .dco-status{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-interactive-bg,rgba(255,255,255,.04));font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);white-space:nowrap}
      .dco-status-dot{width:7px;height:7px;border-radius:50%;background:#71717a;box-shadow:0 0 0 3px rgba(113,113,122,.14)}
      .dco-status[data-state=connected]{color:var(--dco-good);border-color:color-mix(in srgb,var(--dco-good) 30%,transparent);background:color-mix(in srgb,var(--dco-good) 8%,transparent)}
      .dco-status[data-state=connected] .dco-status-dot{background:var(--dco-good);box-shadow:0 0 0 3px color-mix(in srgb,var(--dco-good) 16%,transparent)}
      .dco-status[data-state=warning]{color:var(--dco-ok);border-color:color-mix(in srgb,var(--dco-ok) 30%,transparent);background:color-mix(in srgb,var(--dco-ok) 8%,transparent)}
      .dco-status[data-state=warning] .dco-status-dot{background:var(--dco-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--dco-ok) 16%,transparent)}
      .dco-status[data-state=error]{color:var(--dco-critical);border-color:color-mix(in srgb,var(--dco-critical) 30%,transparent);background:color-mix(in srgb,var(--dco-critical) 8%,transparent)}
      .dco-status[data-state=error] .dco-status-dot{background:var(--dco-critical);box-shadow:0 0 0 3px color-mix(in srgb,var(--dco-critical) 16%,transparent)}
      .dco-card{display:flex;flex-direction:column;gap:14px;padding:18px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.09));border-radius:16px;background:var(--dsw-specific-card-fill,rgba(255,255,255,.025))}
      .dco-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .dco-card-title{margin:0;font-size:13px;font-weight:700;letter-spacing:.045em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#a1a1aa)}
      .dco-card-subtitle{margin:5px 0 0;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;line-height:1.45}
      .dco-head-side{display:flex;align-items:center;gap:8px;flex:none;color:var(--dsw-alias-label-tertiary,#85858d);font-size:11px;white-space:nowrap}
      .dco-account{display:flex;align-items:center;gap:13px;min-width:0}
      .dco-avatar{display:flex;align-items:center;justify-content:center;flex:none;width:42px;height:42px;border-radius:50%;background:linear-gradient(145deg,var(--dco-accent-2),var(--dco-accent));color:#fff;font-weight:700;font-size:17px}
      .dco-avatar[data-empty=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.1));color:var(--dsw-alias-label-tertiary,#888)}
      .dco-account-text{display:flex;flex-direction:column;gap:4px;min-width:0}
      .dco-account-name{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;font-weight:650}
      .dco-account-email{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dco-tier{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--dco-accent) 16%,transparent);border:1px solid color-mix(in srgb,var(--dco-accent) 30%,transparent);color:var(--dco-accent-2);font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase}
      .dco-meta{color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dco-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:9px;background:var(--dsw-alias-interactive-bg,rgba(255,255,255,.05));color:var(--dsw-alias-label-primary,#f4f4f5);font:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease;white-space:nowrap}
      .dco-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.1));border-color:var(--dsw-alias-border-l1,rgba(255,255,255,.25));transform:translateY(-1px)}
      .dco-btn:active:not(:disabled){transform:translateY(0)}
      .dco-btn:disabled{opacity:.52;cursor:not-allowed}
      .dco-btn:focus-visible,.dco-switch:focus-visible,.dco-segment:focus-visible,.dco-meter-btn:focus-visible{outline:2px solid var(--dco-accent-2);outline-offset:2px}
      .dco-btn-primary{border-color:var(--dco-accent);background:linear-gradient(145deg,var(--dco-accent-2),var(--dco-accent));color:#fff;box-shadow:0 7px 16px color-mix(in srgb,var(--dco-accent) 25%,transparent)}
      .dco-btn-primary:hover:not(:disabled){background:linear-gradient(145deg,#fbbf24,var(--dco-accent));border-color:var(--dco-accent-2)}
      .dco-btn-danger{color:#f87171;border-color:rgba(239,68,68,.28);background:rgba(239,68,68,.05)}
      .dco-btn-quiet{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa)}
      .dco-btn-quiet:hover:not(:disabled){border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
      .dco-btn-sm{min-height:28px;padding:4px 9px;font-size:11px}
      .dco-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      .dco-banner{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--dco-accent) 35%,transparent);border-radius:12px;background:color-mix(in srgb,var(--dco-accent) 10%,transparent);color:var(--dsw-alias-label-primary,#f4f4f5);font-size:12px;line-height:1.5;animation:dco-in .2s ease-out}
      .dco-banner strong{color:var(--dco-accent-2)}
      .dco-link{display:inline;margin:0 14px 0 0;padding:0;border:0;background:none;color:var(--dco-accent-2);font:inherit;text-decoration:underline;cursor:pointer}
      .dco-banner[data-tone=error]{border-color:rgba(239,68,68,.34);background:rgba(239,68,68,.08)}
      .dco-banner[data-tone=error] strong{color:#f87171}
      .dco-banner-icon{display:flex;flex:none;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;background:color-mix(in srgb,var(--dco-accent) 20%,transparent);color:var(--dco-accent-2);font-size:11px;font-weight:800}
      .dco-banner[data-tone=error] .dco-banner-icon{background:rgba(239,68,68,.18);color:#f87171}
      .dco-empty{padding:15px;border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:11px;color:var(--dsw-alias-label-tertiary,#85858d);font-size:12px;line-height:1.5}
      .dco-note{display:flex;align-items:flex-start;gap:9px;color:var(--dsw-alias-label-tertiary,#85858d);font-size:11px;line-height:1.5}
      .dco-note-mark{display:flex;align-items:center;justify-content:center;flex:none;width:18px;height:18px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:50%;font-size:10px}

      /* quota: shared bar + four-step colour (remaining >=60 good, >=40 ok, >=20 low, else critical) */
      .dco-bar{position:relative;overflow:hidden;height:8px;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.1))}
      .dco-bar-fill{height:100%;border-radius:inherit;transition:width .35s ease,background-color .2s ease}
      [data-step=good]{--dco-step:var(--dco-good)}[data-step=ok]{--dco-step:var(--dco-ok)}[data-step=low]{--dco-step:var(--dco-low)}[data-step=critical]{--dco-step:var(--dco-critical)}
      .dco-bar-fill{background:var(--dco-step,var(--dco-good))}
      .dco-wins{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .dco-win{display:flex;flex-direction:column;gap:9px;padding:14px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-interactive-bg,rgba(255,255,255,.025))}
      .dco-win-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
      .dco-win-label{display:flex;align-items:center;gap:7px;min-width:0;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px}
      .dco-win-value{color:var(--dco-step);font-size:22px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
      .dco-win-value small{color:var(--dsw-alias-label-tertiary,#85858d);font-size:11px;font-weight:500;letter-spacing:0}
      .dco-win-foot{display:flex;flex-direction:column;gap:2px;color:var(--dsw-alias-label-tertiary,#85858d);font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums}
      .dco-chip{padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--dco-step) 16%,transparent);color:var(--dco-step);font-size:10px;font-weight:700;white-space:nowrap}
      .dco-source{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg,rgba(255,255,255,.05));color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:11px;white-space:nowrap}
      .dco-source[data-kind=usage]{color:var(--dco-good);background:color-mix(in srgb,var(--dco-good) 9%,transparent)}
      .dco-source i{width:6px;height:6px;border-radius:50%;background:currentColor}
      .dco-segmented{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:10px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.035))}
      .dco-segment{border:0;border-radius:7px;padding:6px 10px;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font:inherit;font-size:11px;cursor:pointer}
      .dco-segment:hover{color:var(--dsw-alias-label-primary,#fff)}
      .dco-segment[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#fff);font-weight:650}
      .dco-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))}
      .dco-foot-label{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px}

      /* models */
      .dco-search{box-sizing:border-box;width:100%;min-height:34px;padding:7px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:9px;background:var(--dsw-alias-bg-base,rgba(255,255,255,.035));color:var(--dsw-alias-label-primary,#f4f4f5);font:inherit;font-size:12px}
      .dco-search::placeholder{color:var(--dsw-alias-label-tertiary,#85858d)}
      .dco-family{display:flex;flex-direction:column;gap:9px}
      .dco-family-title{margin:0;color:var(--dsw-alias-label-tertiary,#85858d);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
      .dco-model-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .dco-model{display:flex;flex-direction:column;gap:11px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.09));border-radius:12px;background:var(--dsw-alias-interactive-bg,rgba(255,255,255,.025));transition:opacity .15s ease,border-color .15s ease}
      .dco-model[data-enabled=false]{opacity:.55}
      .dco-model[data-default=true]{border-color:color-mix(in srgb,var(--dco-accent) 55%,transparent)}
      .dco-model-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .dco-model-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
      .dco-model-name{display:flex;align-items:center;gap:7px;min-width:0;font-size:13px;font-weight:650}
      .dco-model-name span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dco-model-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#85858d);font:10.5px ui-monospace,SFMono-Regular,Menlo,monospace}
      .dco-model-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .dco-model-tags{display:flex;flex-wrap:wrap;gap:4px}
      .dco-tag{padding:2px 6px;border-radius:5px;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:10px;font-weight:700;white-space:nowrap}
      .dco-tag-thinking{background:color-mix(in srgb,var(--dco-accent) 16%,transparent);color:var(--dco-accent-2)}
      .dco-tag-default{background:color-mix(in srgb,var(--dco-accent) 20%,transparent);color:var(--dco-accent-2)}
      .dco-switch{position:relative;flex:none;width:38px;height:22px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.2));cursor:pointer;transition:background .15s ease}
      .dco-switch[aria-checked=true]{background:var(--dco-accent)}
      .dco-switch:disabled{opacity:.5;cursor:not-allowed}
      .dco-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s ease}
      .dco-switch[aria-checked=true] span{left:19px}

      /* composer meter */
      .dco-toolbar{position:relative;display:inline-flex;align-items:center}
      .dco-meter-btn{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#b7b9c2);font:11px/1 Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums;cursor:pointer}
      .dco-meter-btn:hover,.dco-meter-btn[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#fff)}
      .dco-mini{display:block;width:44px;height:6px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.14))}
      .dco-mini i{display:block;height:100%;border-radius:inherit;background:var(--dco-step,var(--dco-good))}
      .dco-mini[data-empty=true]{background:transparent;border:1px dashed var(--dsw-alias-border-l1,rgba(255,255,255,.3))}
      .dco-tip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:1000;display:flex;flex-direction:column;gap:3px;padding:6px 9px;border-radius:7px;background:var(--dsw-specific-tip,#1f2329);color:var(--dsw-alias-label-primary,#fff);box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,.2));font-size:11.5px;line-height:1.45;white-space:nowrap;pointer-events:none}
      .dco-popover{position:absolute;right:0;bottom:calc(100% + 9px);z-index:10000;width:330px;max-width:calc(100vw - 28px);display:flex;flex-direction:column;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.16));border-radius:14px;background:var(--dsw-alias-bg-floating,#1a1a20);box-shadow:0 16px 38px rgba(0,0,0,.42);animation:dco-pop .16s cubic-bezier(.16,1,.3,1)}
      .dco-pop-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:650}
      .dco-pop-action{width:26px;height:26px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);cursor:pointer}
      .dco-pop-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.1));color:#fff}
      .dco-pop-action:disabled{opacity:.5}
      .dco-pop-wins{display:flex;flex-direction:column;gap:10px}
      .dco-dock{display:flex;align-items:center;gap:12px;width:100%;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.09));border-radius:9px 9px 0 0;background:var(--dsw-specific-tip,rgba(255,255,255,.025));font-size:11px}
      .dco-dock-label{font-weight:650;white-space:nowrap}
      .dco-dock-meter{display:flex;align-items:center;gap:6px;flex:1;min-width:60px}
      .dco-dock-meter .dco-mini{flex:1;width:auto}
      .dco-dock-meter b{font-weight:600;font-variant-numeric:tabular-nums}
      .dco-dock-hint{flex:1;color:var(--dsw-alias-label-tertiary,#85858d)}
      @keyframes dco-in{from{opacity:0;transform:translateY(4px)}}@keyframes dco-pop{from{opacity:0;transform:translateY(4px) scale(.985)}}
      .dco-win-value{color:color-mix(in srgb,var(--dco-step) 70%,var(--dsw-alias-label-primary,#f4f4f5))}
      .dco-card-head{flex-wrap:wrap}.dco-hero h2{overflow-wrap:anywhere}.dco-model-copy{flex:1}.dco-model-name{flex-wrap:wrap}.dco-model-name span:first-child{white-space:normal;overflow-wrap:anywhere}.dco-model-bottom{flex-wrap:wrap}.dco-account-name{flex-wrap:wrap}.dco-account-email{max-width:100%}.dco-win-top{flex-wrap:wrap}
      @media (max-width:640px){.dco-hero{padding:17px}.dco-hero-actions{width:100%}.dco-hero-actions .dco-btn{flex:1}.dco-wins,.dco-model-grid{grid-template-columns:1fr}.dco-card{padding:14px}}
      @media (prefers-reduced-motion:reduce){.dco-hero,.dco-banner,.dco-popover{animation:none}.dco-btn,.dco-bar-fill,.dco-switch,.dco-switch span{transition:none}}
    `

    function ensureStyles() {
      if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) return
      const style = document.createElement('style')
      style.dataset.plugin = name
      style.dataset.pluginCss = CSS_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // The language follows the page (DSH sets it) rather than only the browser.
    function isZh() {
      try { return /^zh/i.test(document.documentElement.lang || navigator.language || '') } catch { return false }
    }
    const tx = (en, zh) => (isZh() ? zh : en)

    // ---- pure helpers (exported for tests) ---------------------------------------------------------
    function quotaStep(remaining) {
      if (remaining >= 60) return 'good'
      if (remaining >= 40) return 'ok'
      if (remaining >= 20) return 'low'
      return 'critical'
    }

    function titleCase(word) {
      return word ? word[0].toUpperCase() + word.slice(1) : word
    }

    function extraLabel(id) {
      const parts = String(id).split('_')
      const model = parts.length > 2 ? parts.slice(2).map(titleCase).join(' ') : ''
      const base = String(id).startsWith('seven_day') ? tx('7-day', '7 天') : String(id).startsWith('five_hour') ? tx('5-hour', '5 小时') : parts.map(titleCase).join(' ')
      return model ? `${base} · ${model}` : base
    }

    function collectWindows(data) {
      if (!data) return []
      const out = []
      const push = (id, label, short, entry, primary) => {
        const raw = entry && typeof entry.utilization === 'number' && Number.isFinite(entry.utilization) ? entry.utilization : null
        if (raw == null) return
        const used = Math.min(1, Math.max(0, raw))
        const exhausted = entry.status === 'rejected' || used >= 1
        out.push({ id, label, short, primary, used: exhausted ? 100 : Math.round(used * 100), remaining: exhausted ? 0 : Math.round((1 - used) * 100), reset: typeof entry.reset === 'number' ? entry.reset : null })
      }
      push('five_hour', tx('5-hour window', '5 小时窗口'), '5h', data.fiveHour, true)
      push('seven_day', tx('7-day window', '7 天窗口'), '7d', data.sevenDay, true)
      for (const extra of Array.isArray(data.extra) ? data.extra : []) push(extra.id, extraLabel(extra.id), extraLabel(extra.id), extra, false)
      return out
    }

    // The window that will run out first decides the composer colour.
    function tightestWindow(windows) {
      const pool = windows.filter((win) => win.primary)
      const list = pool.length ? pool : windows
      return list.reduce((best, win) => (!best || win.remaining < best.remaining ? win : best), null)
    }

    function timeLeft(ts, now = Date.now()) {
      const seconds = Math.max(0, Math.floor(ts - now / 1000))
      if (!seconds) return null
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (days) return tx(`${days}d ${hours}h`, `${days} 天 ${hours} 小时`)
      if (hours) return tx(`${hours}h ${minutes}m`, `${hours} 小时 ${minutes} 分钟`)
      return tx(`${Math.max(1, minutes)}m`, `${Math.max(1, minutes)} 分钟`)
    }

    function exactTime(ts, now = Date.now()) {
      const date = new Date(ts * 1000)
      const sameDay = date.toDateString() === new Date(now).toDateString()
      const options = sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      try { return new Intl.DateTimeFormat(undefined, options).format(date) } catch { return date.toLocaleString() }
    }

    function resetLine(ts) {
      if (!ts) return tx('Reset time unavailable', '暂无重置时间')
      const left = timeLeft(ts)
      if (!left) return tx('Resetting now', '即将重置')
      return tx(`Resets in ${left} · ${exactTime(ts)}`, `${left}后重置 · ${exactTime(ts)}`)
    }

    function formatTokens(count) {
      return count >= 1e6 ? `${+(count / 1e6).toFixed(1)}M` : `${Math.round(count / 1000)}k`
    }

    function prettyTier(tier) {
      const words = String(tier || '').replace(/^default_/, '').replace(/^claude_/, '').split('_').filter(Boolean)
      return words.map((word) => (/^\d/.test(word) ? word : titleCase(word))).join(' ')
    }

    function clock(value) {
      return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const FAMILIES = ['opus', 'sonnet', 'haiku', 'other']
    function familyOf(model) {
      const text = `${model.id} ${model.name || ''}`.toLowerCase()
      return FAMILIES.find((family) => family !== 'other' && text.includes(family)) || 'other'
    }

    function groupModels(models, query) {
      const needle = String(query || '').trim().toLowerCase()
      const shown = needle ? models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(needle)) : models
      return FAMILIES.map((family) => ({ family, models: shown.filter((model) => familyOf(model) === family) })).filter((group) => group.models.length)
    }

    function cleanError(value) {
      if (!value) return null
      const text = String(value)
      if (text.includes('401') || text.includes('OAuth token rejected')) return tx('Your Claude session expired. Sign in again to continue.', 'Claude 登录已过期，请重新登录。')
      if (text.includes('429') || text.includes('rate_limit')) return tx('Claude has reached a usage limit. Check the reset countdown.', 'Claude 已达到使用额度限制，请查看重置倒计时。')
      return text.length > 180 ? `${text.slice(0, 180)}…` : text
    }

    async function jsonRequest(url, options) {
      const body = options && options.body
      const response = await fetch(url, { cache: 'no-store', ...options, headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) } })
      const value = await response.json().catch(() => null)
      if (!response.ok || !value || value.ok === false) throw new Error((value && value.error) || `HTTP ${response.status}`)
      return value
    }

    // ---- small components ----------------------------------------------------------------------------
    function ClaudeMark({ size = 20 }) {
      return h('span', { className: 'dco-mark', style: { width: size * 2.1, height: size * 2.1 }, 'aria-hidden': true },
        h('svg', { viewBox: '0 0 24 24', fill: 'none' },
          h('path', { d: 'M5 12h14M12 5v14M6.8 6.8l10.4 10.4M17.2 6.8 6.8 17.2', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
          h('circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor' })))
    }

    function Status({ state, children }) {
      return h('span', { className: 'dco-status', 'data-state': state }, h('span', { className: 'dco-status-dot' }), children)
    }

    function Button({ primary = false, danger = false, quiet = false, small = false, children, ...props }) {
      const cls = ['dco-btn', primary && 'dco-btn-primary', danger && 'dco-btn-danger', quiet && 'dco-btn-quiet', small && 'dco-btn-sm'].filter(Boolean).join(' ')
      return h('button', { ...props, type: props.type || 'button', className: cls }, children)
    }

    function Bar({ remaining, label }) {
      return h('div', { className: 'dco-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': remaining, 'aria-label': label },
        h('div', { className: 'dco-bar-fill', style: { width: `${remaining}%` } }))
    }

    function WindowCard({ win, limiting }) {
      return h('div', { className: 'dco-win', 'data-step': quotaStep(win.remaining) },
        h('div', { className: 'dco-win-top' },
          h('span', { className: 'dco-win-label' }, win.label, limiting ? h('span', { className: 'dco-chip' }, tx('Lowest remaining', '剩余最少')) : null),
          h('span', { className: 'dco-win-value' }, `${win.remaining}%`, h('small', null, ` ${tx('left', '剩余')}`))),
        h(Bar, { remaining: win.remaining, label: win.label }),
        h('div', { className: 'dco-win-foot' }, h('span', null, `${win.used}% ${tx('used', '已使用')}`), h('span', null, resetLine(win.reset))))
    }

    function sourceNote(data) {
      if (data && data.source === 'usage') return { kind: 'usage', text: tx('Live read · uses no quota', '实时读取 · 不消耗额度') }
      if (data && data.source === 'probe') return { kind: 'probe', text: tx('From one minimal request · uses a little quota', '来自一次最小请求 · 会消耗少量额度') }
      return { kind: 'none', text: tx('Not read automatically', '未自动读取') }
    }

    // ---- active model + quota data ------------------------------------------------------------------
    function useAnthropicActive(modelDirectories, sessionId) {
      const read = React.useCallback(() => {
        if (!modelDirectories || !sessionId) return false
        try {
          const directory = modelDirectories.directoryFor(sessionId)
          return directory?.store?.getSnapshot?.().current?.provider === PROVIDER
        } catch {
          return false
        }
      }, [modelDirectories, sessionId])
      const [active, setActive] = React.useState(read)
      React.useEffect(() => {
        setActive(read())
        if (!modelDirectories || !sessionId) return undefined
        try {
          const store = modelDirectories.directoryFor(sessionId)?.store
          if (typeof store?.subscribe !== 'function') return undefined
          return store.subscribe(() => setActive(read()))
        } catch {
          return undefined
        }
      }, [modelDirectories, sessionId, read])
      return active
    }

    // Automatic reads never spend quota (the host answers from the free source or from cache); only load(true) may.
    function useQuota(active) {
      const [state, setState] = React.useState({ status: 'idle', data: null, error: null })
      const inFlight = React.useRef(false)
      const controllerRef = React.useRef(null)
      const load = React.useCallback(async (force = false) => {
        if (!active || inFlight.current) return null
        inFlight.current = true
        const controller = new AbortController()
        controllerRef.current = controller
        setState((previous) => ({ ...previous, status: 'loading' }))
        try {
          const response = await fetch(`${QUOTA_URL}${force ? '?force=1' : ''}`, { cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json' } })
          const value = await response.json()
          if (!response.ok) throw new Error(value?.error || `HTTP ${response.status}`)
          if (controller.signal.aborted) return null
          if (value?.ok === false) setState((previous) => ({ status: 'error', data: previous.data, error: value.error || 'Quota unavailable.' }))
          else if (value?.manualRequired) setState((previous) => ({ status: 'manual', data: previous.data, error: null }))
          else setState({ status: 'ready', data: value, error: null })
          return value
        } catch (error) {
          if (!controller.signal.aborted) setState((previous) => ({ status: 'error', data: previous.data, error: error?.message || String(error) }))
          return null
        } finally {
          inFlight.current = false
          if (controllerRef.current === controller) controllerRef.current = null
        }
      }, [active])
      React.useEffect(() => {
        if (!active) { setState({ status: 'idle', data: null, error: null }); return undefined }
        void load(false)
        const timer = setInterval(() => { void load(false) }, POLL_MS)
        const focus = () => { void load(false) }
        window.addEventListener('focus', focus)
        return () => { clearInterval(timer); window.removeEventListener('focus', focus); controllerRef.current?.abort() }
      }, [active, load])
      return { ...state, load }
    }

    const PLACEMENT_KEY = 'dsh-anthropic-oauth-placement'
    const PLACEMENT_EVENT = 'dsh-anthropic-oauth-placement-change'

    function readPlacement() {
      try { return localStorage.getItem(PLACEMENT_KEY) || 'toolbar' } catch { return 'toolbar' }
    }

    // Which quota surface the user chose; the others render nothing and read nothing.
    function usePlacement() {
      const [placement, setPlacement] = React.useState(readPlacement)
      React.useEffect(() => {
        const sync = () => setPlacement(readPlacement())
        window.addEventListener(PLACEMENT_EVENT, sync)
        window.addEventListener('storage', sync)
        return () => { window.removeEventListener(PLACEMENT_EVENT, sync); window.removeEventListener('storage', sync) }
      }, [])
      return placement
    }

    // ---- composer surfaces ---------------------------------------------------------------------------
    function ToolbarQuota({ modelDirectories, sessionId }) {
      const anthropic = useAnthropicActive(modelDirectories, sessionId)
      const placement = usePlacement()
      const active = anthropic && placement === 'toolbar'
      const quota = useQuota(active)
      const [open, setOpen] = React.useState(false)
      const [hover, setHover] = React.useState(false)
      const root = React.useRef(null)
      React.useEffect(() => {
        if (!open) return undefined
        const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
        const key = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', close)
        document.addEventListener('keydown', key)
        return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) }
      }, [open])
      if (!active) return null
      const windows = collectWindows(quota.data)
      // Stay quiet until there is something to say: no placeholder while the first read is in flight.
      if (!windows.length && (quota.status === 'idle' || quota.status === 'loading')) return null
      const tight = tightestWindow(windows)
      const primary = windows.filter((win) => win.primary)
      const shown = primary.length ? primary : windows
      const summary = tight
        ? tx(`Claude quota: ${tight.remaining}% left in the ${tight.short} window`, `Claude 额度：${tight.short} 窗口剩余 ${tight.remaining}%`)
        : quota.status === 'error' ? tx('Claude quota unavailable', 'Claude 额度不可用') : tx('Claude quota not read yet. Click to check (uses a little quota).', 'Claude 额度尚未读取，点击查询（会消耗少量额度）')
      const step = tight ? quotaStep(tight.remaining) : undefined
      return h('div', { className: 'dco-toolbar', ref: root, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) },
        h('button', { type: 'button', className: 'dco-meter-btn', 'data-step': step, 'aria-expanded': open, 'aria-label': summary, onClick: () => setOpen((value) => !value), onFocus: () => setHover(true), onBlur: () => setHover(false) },
          h('span', { className: 'dco-mini', 'data-empty': !tight, 'aria-hidden': true }, tight ? h('i', { style: { width: `${tight.remaining}%` } }) : null),
          h('span', null, tight ? `${tight.remaining}%` : quota.status === 'error' ? '!' : '—')),
        hover && !open ? h('div', { className: 'dco-tip', role: 'tooltip' },
          shown.length ? shown.map((win) => h('span', { key: win.id }, `${win.short} · ${win.remaining}% ${tx('left', '剩余')} · ${win.reset && timeLeft(win.reset) ? tx(`resets in ${timeLeft(win.reset)}`, `${timeLeft(win.reset)}后重置`) : tx('reset unknown', '重置时间未知')}`)) : h('span', null, summary)) : null,
        open ? h('div', { className: 'dco-popover', role: 'dialog', 'aria-label': tx('Claude quota details', 'Claude 额度详情') },
          h('div', { className: 'dco-pop-head' }, h('span', null, tx('Claude quota', 'Claude 额度')), h('button', { type: 'button', className: 'dco-pop-action', disabled: quota.status === 'loading', onClick: () => void quota.load(true), 'aria-label': tx('Refresh quota', '刷新额度'), title: tx('Refresh', '刷新') }, quota.status === 'loading' ? '…' : '↻')),
          quota.status === 'error' ? h('div', { className: 'dco-banner', 'data-tone': 'error' }, h('span', { className: 'dco-banner-icon' }, '!'), h('span', null, cleanError(quota.error))) : null,
          shown.length ? h('div', { className: 'dco-pop-wins' }, shown.map((win) => h(WindowCard, { key: win.id, win, limiting: shown.length > 1 && win === tight && win.remaining < 100 }))) : h('div', { className: 'dco-empty' }, tx('No quota data yet. Refresh sends one minimal request.', '还没有额度数据。刷新会发送一次最小请求。')),
          h('span', { className: 'dco-source', 'data-kind': sourceNote(quota.data).kind }, h('i'), sourceNote(quota.data).text)) : null)
    }

    function DockQuota({ modelDirectories, sessionId }) {
      const anthropic = useAnthropicActive(modelDirectories, sessionId)
      const placement = usePlacement()
      const active = anthropic && placement === 'dock'
      const quota = useQuota(active)
      if (!active) return null
      const windows = collectWindows(quota.data).filter((win) => win.primary)
      if (!windows.length && (quota.status === 'idle' || quota.status === 'loading')) return null
      return h('div', { className: 'dco-dock' },
        h('span', { className: 'dco-dock-label' }, 'Claude'),
        windows.length
          ? windows.map((win) => h('div', { className: 'dco-dock-meter', key: win.id, 'data-step': quotaStep(win.remaining), title: resetLine(win.reset) }, h('span', null, win.short), h('span', { className: 'dco-mini' }, h('i', { style: { width: `${win.remaining}%` } })), h('b', null, `${win.remaining}%`)))
          : h('span', { className: 'dco-dock-hint' }, quota.status === 'error' ? cleanError(quota.error) : tx('Quota is not read automatically. Use ↻ to check (uses a little quota).', '额度不会自动读取，点 ↻ 查询（会消耗少量额度）。')),
        h('button', { type: 'button', className: 'dco-pop-action', disabled: quota.status === 'loading', onClick: () => void quota.load(true), 'aria-label': tx('Refresh quota', '刷新额度') }, quota.status === 'loading' ? '…' : '↻'))
    }

    // ---- settings: quota card ------------------------------------------------------------------------
    function QuotaCard({ authenticated, placement, onPlacement }) {
      const quota = useQuota(authenticated)
      const windows = collectWindows(quota.data)
      const tight = tightestWindow(windows)
      const source = sourceNote(quota.data)
      const loading = quota.status === 'loading'
      const placements = [['toolbar', tx('Composer meter', '输入框小条')], ['dock', tx('Above composer', '输入框上方')], ['hidden', tx('Hidden', '隐藏')]]
      return h('section', { className: 'dco-card' },
        h('div', { className: 'dco-card-head' },
          h('div', null, h('h3', { className: 'dco-card-title' }, tx('Quota', '额度')), h('p', { className: 'dco-card-subtitle' }, tx('Remaining capacity per window. The lowest primary window sets the indicator colour.', '各窗口的剩余额度。输入框颜色取两个主要窗口中剩余较少的一档。'))),
          h('div', { className: 'dco-head-side' }, quota.data?.fetchedAt ? `${tx('Updated', '更新于')} ${clock(quota.data.fetchedAt * 1000)}` : null)),
        quota.status === 'error' ? h('div', { className: 'dco-banner', 'data-tone': 'error' }, h('span', { className: 'dco-banner-icon' }, '!'), h('span', null, cleanError(quota.error))) : null,
        windows.length
          ? h('div', { className: 'dco-wins' }, windows.map((win) => h(WindowCard, { key: win.id, win, limiting: windows.filter((item) => item.primary).length > 1 && win === tight && win.remaining < 100 })))
          : h('div', { className: 'dco-empty' }, quota.status === 'loading' || quota.status === 'idle' ? tx('Reading quota…', '正在读取额度…') : quota.status === 'error' ? tx('Could not read quota. Retry the read without sending a model request.', '额度读取失败，可重试读取；重试不会发送模型请求。') : tx('No read-only quota data is available. A manual probe sends one minimal model request.', '未取得只读额度数据。手动探测会发送一次最小模型请求。')),
        h('div', { className: 'dco-actions' },
          h(Button, { small: true, disabled: loading, onClick: () => void quota.load(quota.status === 'manual' || quota.data?.source === 'probe') }, loading ? tx('Refreshing…', '刷新中…') : quota.status === 'error' ? tx('Retry read', '重试读取') : quota.status === 'manual' || quota.data?.source === 'probe' ? tx('Probe quota (uses allowance)', '探测额度（消耗少量额度）') : tx('Refresh quota', '刷新额度')),
          h('span', { className: 'dco-source', 'data-kind': source.kind }, h('i'), source.text)),
        h('div', { className: 'dco-foot' },
          h('span', { className: 'dco-foot-label' }, tx('Show quota in', '额度显示在')),
          h('div', { className: 'dco-segmented', role: 'group', 'aria-label': tx('Quota placement', '额度显示位置') },
            placements.map(([value, label]) => h('button', { key: value, type: 'button', className: 'dco-segment', 'aria-pressed': placement === value, onClick: () => onPlacement(value) }, label)))))
    }

    // ---- settings: model selection ---------------------------------------------------------------------
    function ModelCard({ model, isDefault, canSetDefault, busy, lastEnabled, onToggle, onDefault }) {
      return h('div', { className: 'dco-model', 'data-enabled': model.enabled, 'data-default': isDefault },
        h('div', { className: 'dco-model-top' },
          h('div', { className: 'dco-model-copy' },
            h('span', { className: 'dco-model-name' }, h('span', { title: model.name }, model.name), isDefault ? h('span', { className: 'dco-tag dco-tag-default' }, tx('Default', '默认')) : null),
            h('span', { className: 'dco-model-id', title: model.id }, model.id)),
          h('button', { type: 'button', role: 'switch', className: 'dco-switch', 'aria-checked': model.enabled, 'aria-label': tx(`Offer ${model.name} in DSH`, `在 DSH 中提供 ${model.name}`), title: isDefault ? tx('Choose another default model before disabling this one', '请先更换默认模型，再停用此模型') : model.enabled && lastEnabled ? tx('At least one model must stay enabled', '至少保留一个已启用的模型') : undefined, disabled: busy || isDefault || (model.enabled && lastEnabled), onClick: () => onToggle(model) }, h('span'))),
        h('div', { className: 'dco-model-bottom' },
          h('div', { className: 'dco-model-tags' },
            model.contextWindow ? h('span', { className: 'dco-tag' }, `${formatTokens(model.contextWindow)} ${tx('context', '上下文')}`) : null,
            model.reasoning ? h('span', { className: 'dco-tag dco-tag-thinking' }, tx('Thinking', '推理')) : null),
          canSetDefault && model.enabled && !isDefault ? h(Button, { quiet: true, small: true, disabled: busy, onClick: () => onDefault(model) }, tx('Make default', '设为默认')) : null))
    }

    function ModelSection({ authenticated, version }) {
      const [view, setView] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      React.useEffect(() => {
        if (!authenticated) { setView(null); return undefined }
        let cancelled = false
        jsonRequest(MODELS_URL).then((value) => { if (!cancelled) { setView(value); setError(null) } }).catch((cause) => { if (!cancelled) setError(cause.message) })
        return () => { cancelled = true }
      }, [authenticated, version])
      const mutate = React.useCallback(async (body) => {
        setBusy(true); setError(null)
        try { setView(await jsonRequest(MODELS_URL, { method: 'POST', body: JSON.stringify(body) })) } catch (cause) { setError(cause.message) } finally { setBusy(false) }
      }, [])
      const models = view?.models || []
      const enabledIds = models.filter((model) => model.enabled).map((model) => model.id)
      const toggle = (model) => mutate({ enabled: model.enabled ? enabledIds.filter((id) => id !== model.id) : models.filter((item) => item.enabled || item.id === model.id).map((item) => item.id) })
      const groups = groupModels(models, query)
      const familyLabel = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', other: tx('Other', '其他') }
      return h('section', { className: 'dco-card' },
        h('div', { className: 'dco-card-head' },
          h('div', null, h('h3', { className: 'dco-card-title' }, tx('Models', '模型')), h('p', { className: 'dco-card-subtitle' }, tx('Choose which Claude models DSH offers in its model picker.', '选择 DSH 模型选择器里提供哪些 Claude 模型。'))),
          h('div', { className: 'dco-head-side' }, models.length ? h('span', { className: 'dco-source' }, tx(`${enabledIds.length} of ${models.length} on`, `已启用 ${enabledIds.length}/${models.length}`)) : null, models.length && enabledIds.length < models.length ? h(Button, { quiet: true, small: true, disabled: busy, onClick: () => mutate({ enabled: models.map((model) => model.id) }) }, tx('Enable all', '全部启用')) : null)),
        error ? h('div', { className: 'dco-banner', 'data-tone': 'error' }, h('span', { className: 'dco-banner-icon' }, '!'), h('span', null, cleanError(error))) : null,
        models.length > 4 ? h('input', { className: 'dco-search', type: 'search', value: query, placeholder: tx('Search models', '搜索模型'), 'aria-label': tx('Search models', '搜索模型'), onChange: (event) => setQuery(event.target.value) }) : null,
        !models.length
          ? h('div', { className: 'dco-empty' }, authenticated ? tx('Could not load the model list from your account. Use Sync account to try again.', '未能从账户获取模型列表，请点击“同步账户”重试。') : tx('Sign in to discover the models available to your Claude account.', '登录后即可发现当前 Claude 账户可用的模型。'))
          : groups.length
            ? groups.map((group) => h('div', { className: 'dco-family', key: group.family }, h('h4', { className: 'dco-family-title' }, familyLabel[group.family]), h('div', { className: 'dco-model-grid' }, group.models.map((model) => h(ModelCard, { key: model.id, model, isDefault: view.defaultModel === model.id, canSetDefault: !!view.canSetDefault, busy, lastEnabled: enabledIds.length <= 1, onToggle: toggle, onDefault: (item) => mutate({ defaultModel: item.id }) })))))
            : h('div', { className: 'dco-empty' }, tx('No models match your search.', '没有匹配的模型。')))
    }

    // ---- settings page -------------------------------------------------------------------------------
    function ClaudeSettings() {
      const [status, setStatus] = React.useState({ authenticated: false, message: '', models: [], rateLimit: null })
      const [busy, setBusy] = React.useState(false)
      const [loginPending, setLoginPending] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [placement, setPlacement] = React.useState(readPlacement)
      const [loginUrl, setLoginUrl] = React.useState(null)
      const [confirming, setConfirming] = React.useState(false)
      const fetchStatus = React.useCallback(async () => {
        try {
          const response = await fetch(STATUS_URL, { cache: 'no-store' })
          const next = await response.json()
          setStatus(next)
          return next
        } catch (cause) {
          setError(cause?.message || String(cause))
          return null
        }
      }, [])
      React.useEffect(() => { void fetchStatus() }, [fetchStatus])
      React.useEffect(() => {
        if (!loginPending) return undefined
        let stopped = false
        const timer = setInterval(async () => {
          try {
            const response = await fetch(STATUS_URL, { cache: 'no-store' })
            const next = await response.json()
            if (!stopped && next?.authenticated) { setStatus(next); setLoginPending(false); setLoginUrl(null); setError(null) }
          } catch {}
        }, 2000)
        const timeout = setTimeout(() => { if (!stopped) { setLoginPending(false); setError(tx('Login timed out. You can try again.', '登录等待超时，可以重新尝试。')) } }, 180000)
        return () => { stopped = true; clearInterval(timer); clearTimeout(timeout) }
      }, [loginPending])
      React.useEffect(() => {
        if (!confirming) return undefined
        const timer = setTimeout(() => setConfirming(false), 5000)
        return () => clearTimeout(timer)
      }, [confirming])
      const run = React.useCallback(async (request, fallback) => {
        setBusy(true); setError(null)
        try {
          const response = await request()
          const value = await response.json()
          if (value?.ok === false) throw new Error(value.error || fallback)
          await fetchStatus()
          return value
        } catch (cause) {
          setError(cause?.message || fallback)
          return null
        } finally { setBusy(false) }
      }, [fetchStatus])
      const login = React.useCallback(async () => {
        setError(null)
        // Open the tab synchronously inside the click so pop-up blockers allow it, then point it at the
        // authorization page once the host has started the callback server. (A 'noopener' window.open
        // always returns null, which would look exactly like a blocked pop-up.)
        const tab = window.open('about:blank', '_blank')
        try {
          const response = await fetch(LOGIN_URL, { cache: 'no-store', headers: { accept: 'application/json' } })
          const value = await response.json().catch(() => ({}))
          if (!response.ok || !value?.authUrl) throw new Error(value?.error || tx('Could not start the Claude sign-in.', '无法启动 Claude 登录。'))
          setLoginUrl(value.authUrl)
          setLoginPending(true)
          if (tab) { try { tab.opener = null } catch {} tab.location.href = value.authUrl }
        } catch (cause) {
          try { tab?.close() } catch {}
          setError(cause?.message || tx('Could not start the Claude sign-in.', '无法启动 Claude 登录。'))
        }
      }, [])
      const adopt = React.useCallback(() => void run(() => fetch(ADOPT_URL, { method: 'POST', cache: 'no-store' }), tx('Could not use the existing Claude Code login.', '无法使用已有的 Claude Code 登录。')), [run])
      const sync = React.useCallback(() => void run(() => fetch(SYNC_URL, { method: 'POST', cache: 'no-store' }), tx('Account sync failed.', '账户同步失败。')), [run])
      const logout = React.useCallback(() => {
        setConfirming(false)
        void run(() => fetch(LOGOUT_URL, { method: 'POST', cache: 'no-store' }), tx('Sign out failed.', '退出登录失败。'))
      }, [run])
      const changePlacement = (value) => { setPlacement(value); try { localStorage.setItem(PLACEMENT_KEY, value) } catch {} window.dispatchEvent(new Event(PLACEMENT_EVENT)) }
      const authenticated = !!status.authenticated
      const state = error ? 'error' : loginPending ? 'warning' : authenticated ? 'connected' : 'idle'
      const statusText = error ? tx('Needs attention', '需要处理') : loginPending ? tx('Waiting for browser', '等待浏览器授权') : authenticated ? tx('Connected', '已连接') : tx('Not connected', '未连接')
      return h('div', { className: 'dco-shell' },
        h('section', { className: 'dco-hero' },
          h('div', { className: 'dco-hero-copy' }, h(ClaudeMark, { size: 20 }), h('div', null, h('h2', null, 'dsh-anthropic-oauth'), h('p', { className: 'dco-kicker' }, tx('A calm, native-feeling home for your Claude subscription inside DSH.', '在 DSH 里，以更清晰、更舒服的方式管理 Claude 订阅。')))),
          h('div', { className: 'dco-hero-actions' },
            h(Status, { state }, statusText),
            !authenticated && status.canAdopt ? h(Button, { disabled: busy || loginPending, onClick: adopt, title: tx('Reuse the login already on this machine for Claude Code', '复用本机 Claude Code 已有的登录') }, tx('Use Claude Code login', '使用 Claude Code 登录')) : null,
            !authenticated ? h(Button, { primary: true, disabled: busy || loginPending, onClick: login }, loginPending ? tx('Waiting…', '等待中…') : tx('Sign in', '登录')) : h(Button, { disabled: busy, onClick: sync }, busy ? tx('Syncing…', '同步中…') : tx('Sync account', '同步账户')))),
        loginPending ? h('div', { className: 'dco-banner' }, h('span', { className: 'dco-banner-icon' }, '↗'), h('span', null, h('strong', null, tx('Finish in your browser. ', '请在浏览器中完成授权。')), tx('This page updates automatically once Claude confirms the account. ', 'Claude 确认账户后，此页面会自动更新。'), loginUrl ? h('a', { className: 'dco-link', href: loginUrl, target: '_blank', rel: 'noopener noreferrer' }, tx('Tab did not open? Open the sign-in page', '没有打开？点此打开登录页')) : null, ' ', h('button', { type: 'button', className: 'dco-link', onClick: () => { setLoginPending(false); setLoginUrl(null) } }, tx('Cancel', '取消')))) : null,
        error ? h('div', { className: 'dco-banner', 'data-tone': 'error' }, h('span', { className: 'dco-banner-icon' }, '!'), h('span', null, h('strong', null, tx('Something needs attention. ', '需要处理。')), cleanError(error))) : null,
        h('section', { className: 'dco-card' },
          h('div', { className: 'dco-card-head' },
            h('div', null, h('h3', { className: 'dco-card-title' }, tx('Account', '账户')), h('p', { className: 'dco-card-subtitle' }, authenticated ? tx('Your subscription is ready for model runs.', '订阅已就绪，可以开始模型调用。') : status.canAdopt ? tx('A Claude Code login was found on this machine. It is only used after you choose it.', '检测到本机已有 Claude Code 登录，选择后才会使用。') : tx('Connect once; the profile stays in sync.', '登录一次，此配置会保持同步。'))),
            authenticated ? h('div', { className: 'dco-actions' }, confirming
              ? [h('span', { key: 'q', className: 'dco-meta' }, tx('Disconnect Claude from DSH? Claude Code is not affected.', '从 DSH 断开 Claude？不影响 Claude Code。')), h(Button, { key: 'y', danger: true, small: true, disabled: busy, onClick: logout }, tx('Disconnect', '确认断开')), h(Button, { key: 'n', quiet: true, small: true, onClick: () => setConfirming(false) }, tx('Keep', '保留'))]
              : h(Button, { danger: true, disabled: busy, onClick: () => setConfirming(true) }, tx('Disconnect', '断开'))) : null),
          h('div', { className: 'dco-account' },
            h('div', { className: 'dco-avatar', 'data-empty': !authenticated }, authenticated ? String(status.email || 'C').slice(0, 1).toUpperCase() : '?'),
            h('div', { className: 'dco-account-text' },
              h('div', { className: 'dco-account-name' }, h('span', { className: 'dco-account-email' }, authenticated ? (status.email || tx('Claude account', 'Claude 账户')) : tx('No account connected', '尚未连接账户')), authenticated ? h('span', { className: 'dco-tier' }, String(status.sub || 'Pro').toUpperCase()) : null),
              h('div', { className: 'dco-meta' }, authenticated ? (prettyTier(status.tier) && status.tier !== 'default' ? tx(`OAuth connected · ${prettyTier(status.tier)}`, `OAuth 已连接 · ${prettyTier(status.tier)}`) : tx('OAuth connected', 'OAuth 已连接')) : tx('No token is shown in this page.', '此页面不会显示 token。'))))),
        authenticated ? h(QuotaCard, { authenticated, placement, onPlacement: changePlacement }) : null,
        h(ModelSection, { authenticated, version: status.modelsAt }),
        h('div', { className: 'dco-note' }, h('span', { className: 'dco-note-mark', 'aria-hidden': true }, 'i'), h('span', null, tx('OAuth is handled on the host. This page only receives redacted account state; token values never enter the browser UI.', 'OAuth 在 Host 侧处理。此页面只接收脱敏账户状态，token 不会进入浏览器界面。'))))
    }

    function apply(ctx) {
      ensureStyles()
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'anthropic-oauth', order: 13, label: () => 'dsh-anthropic-oauth' }, (props) => h(ClaudeSettings, props)))
      // The composer surfaces need the session's current model, so they wait for the model directory service
      // (the same way dsh-codex does) instead of guessing when it is missing.
      ctx.inject(['slots', 'modelDirectories'], (scope) => {
        const modelDirectories = scope.modelDirectories
        scope.slots.inject('conversation.input.right', () => scope.slots.register({ name: 'conversation.input.right', id: 'anthropic-oauth-quota', order: 15, inject: (sessionId) => ({ sessionId }) }, (props) => h(ToolbarQuota, { ...props, modelDirectories })))
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({ name: 'conversation.composer.dock', id: 'anthropic-oauth-dock', order: 40, inject: (sessionId) => ({ sessionId }) }, (props) => h(DockQuota, { ...props, modelDirectories })))
      })
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    exports.helpers = { quotaStep, collectWindows, tightestWindow, timeLeft, resetLine, formatTokens, prettyTier, familyOf, groupModels, extraLabel }
    return module.exports
  },
})
