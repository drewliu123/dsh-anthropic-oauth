#!/usr/bin/env node
/**
 * @file CLI helper to sign in to Claude Pro/Max via Google/Gmail OAuth
 * @author grloper <https://github.com/grloper>
 * @license MIT
 */

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { exec } from 'node:child_process'
import { claudeCredsFile, dshHome, escapeHtml } from '../lib/index.js'

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const TOKEN_URL = 'https://claude.ai/v1/oauth/token'
const DEFAULT_SCOPES = 'user:profile user:inference'

function writeSecret(file, contents) {
  const fd = fs.openSync(file, 'w', 0o600)
  try {
    // Creation mode alone does not tighten permissions on an existing file.
    fs.fchmodSync(fd, 0o600)
    fs.writeFileSync(fd, contents)
  } finally {
    fs.closeSync(fd)
  }
}

function openUrl(url) {
  const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'
  exec(`${start} "${url}"`, (err) => {
    if (err) console.log(`Please open this URL in your browser:\n${url}`)
  })
}

export async function main({ env = process.env, fetch: fetchImpl = globalThis.fetch, openBrowser = openUrl, createServer = http.createServer, logger = console } = {}) {
  const scopes = (env.CLAUDE_OAUTH_SCOPES || DEFAULT_SCOPES).trim().split(/\s+/).filter(Boolean)
  logger.log('\n=== Claude OAuth Login for DeepSeek Harness (DSH) ===\n')

  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')

  let server4 = null
  let server6 = null
  let port = 0

  const cleanup = () => {
    try { if (server4) server4.close() } catch {}
    try { if (server6) server6.close() } catch {}
  }

  const codePromise = new Promise((resolve, reject) => {
    const handler = async (req, res) => {
      const u = new URL(req.url || '/', 'http://localhost')
      if (u.pathname === '/callback') {
        const code = u.searchParams.get('code')
        const returnedState = u.searchParams.get('state')
        const error = u.searchParams.get('error')

        if (returnedState !== state) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end('<h1>State mismatch error</h1>')
          reject(new Error('State mismatch'))
          cleanup()
          return
        }

        if (error || !code || !code.trim()) {
          res.statusCode = 400
          res.setHeader('content-type', 'text/html; charset=utf-8')
          const message = error || 'Missing authorization code'
          res.end(`<h1>Login failed: ${escapeHtml(message)}</h1>`)
          reject(new Error(message))
          cleanup()
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(`<!doctype html><html><head><title>Claude Login Successful</title><meta charset="utf-8">
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#18181b;color:#f4f4f5">
<div style="background:#27272a;padding:32px;border-radius:12px;text-align:center;border:1px solid #3f3f46">
  <h1 style="color:#22c55e;font-size:22px;margin:0 0 10px">&#10003; Login Successful</h1>
  <p style="color:#a1a1aa;margin:0">You can close this window and return to your terminal.</p>
</div>
</body></html>`)
        cleanup()
        resolve(code)
      } else {
        res.statusCode = 404
        res.end('Not found')
      }
    }

    server4 = createServer(handler)
    server4.on('error', (error) => { reject(error); cleanup() })
    server4.listen(0, '127.0.0.1', () => {
      port = server4.address().port
      try {
        server6 = createServer(handler)
        // IPv6 is optional; listen failures are emitted asynchronously.
        server6.on('error', () => { try { server6.close() } catch {} })
        server6.listen(port, '::1', () => {})
      } catch {}

      const redirectUri = `http://localhost:${port}/callback`
      const authUrl = `https://claude.ai/oauth/authorize?code=true&client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes.join(' '))}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`

      logger.log('Opening browser for Claude authentication...')
      logger.log('Select "Continue with Google" to log in with your Gmail account.\n')
      try { openBrowser(authUrl) } catch (error) { reject(error); cleanup() }
    })
  })

  try {
    const code = await codePromise
    logger.log('Authorization code received, exchanging for tokens...')

    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: `http://localhost:${port}/callback`,
        code_verifier: verifier,
        state
      })
    })

    const tokens = await res.json()
    if (!res.ok || !tokens.access_token) {
      throw new Error(tokens.error_description || tokens.error || JSON.stringify(tokens))
    }

    let profile = {}
    try {
      const profRes = await fetchImpl('https://api.anthropic.com/api/oauth/profile', {
        headers: { authorization: `Bearer ${tokens.access_token}` }
      })
      if (profRes.ok) profile = await profRes.json()
    } catch {}

    const account = profile.account || {}
    const email = profile.emailAddress || profile.email || account.email_address || account.email || 'unknown'
    const sub = profile.subscriptionType || profile.subscription_type || account.subscription_type || 'pro'

    // Use the same isolation overrides as the host plugin and Claude Code.
    const credFile = claudeCredsFile(env)
    let creds = {}
    try { if (fs.existsSync(credFile)) creds = JSON.parse(fs.readFileSync(credFile, 'utf8')) } catch {}
    creds.claudeAiOauth = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      scopes,
      subscriptionType: sub,
      emailAddress: email
    }
    fs.mkdirSync(path.dirname(credFile), { recursive: true })
    writeSecret(credFile, JSON.stringify(creds, null, 2))

    // Update the selected DSH profile when it already has a credential store.
    const dshCredFile = path.join(dshHome(env), '.credentials.yaml')
    if (fs.existsSync(dshCredFile)) {
      let yaml = fs.readFileSync(dshCredFile, 'utf8')
      const token = tokens.access_token
      if (yaml.includes('ANTHROPIC_OAUTH_TOKEN:')) {
        yaml = yaml.replace(/ANTHROPIC_OAUTH_TOKEN:.*/, `ANTHROPIC_OAUTH_TOKEN: ${token}`)
      } else if (yaml.includes('refs:')) {
        yaml = yaml.replace(/(refs:\n)/, `$1  ANTHROPIC_OAUTH_TOKEN: ${token}\n`)
      }
      if (yaml.includes('CLAUDE_CODE_OAUTH_TOKEN:')) {
        yaml = yaml.replace(/CLAUDE_CODE_OAUTH_TOKEN:.*/, `CLAUDE_CODE_OAUTH_TOKEN: ${token}`)
      } else if (yaml.includes('refs:')) {
        yaml = yaml.replace(/(refs:\n)/, `$1  CLAUDE_CODE_OAUTH_TOKEN: ${token}\n`)
      }
      writeSecret(dshCredFile, yaml)
    }

    logger.log(`\n[SUCCESS] Connected to Claude as: ${email} (${sub.toUpperCase()})`)
    logger.log(`Tokens saved to ${credFile}${fs.existsSync(dshCredFile) ? ` and ${dshCredFile}` : ''}.`)
    logger.log('You can now use Claude models in DeepSeek Harness!\n')
  } finally {
    cleanup()
  }
}

// Importing the CLI for tests must not open a browser or start a login.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch((err) => {
    console.error('\n[ERROR] Login failed:', err.message)
    process.exitCode = 1
  })
}
