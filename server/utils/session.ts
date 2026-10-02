import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { appDir } from './apps'

// Everything about being signed in to the running product. Bower never sees the session itself: the app's
// cookies live in the shared app's Chrome profile (apps.ts). What is kept next to it, never exported:
// - session.json: a page known to need sign-in (where the sign-in window was left), the last check's result
// - login.json: an optional saved login, the password encrypted for this Windows user only
export interface SessionState { home?: string, signedIn?: boolean, checkedAt?: string, reachable?: boolean, error?: string, title?: string }

const sessionFile = (appId: string) => join(appDir(appId), 'session.json')
const loginFile = (appId: string) => join(appDir(appId), 'login.json')

export async function readSession(appId: string): Promise<SessionState> {
  try { return JSON.parse(await fs.readFile(sessionFile(appId), 'utf8')) } catch { return {} }
}

export async function updateSession(appId: string, patch: Partial<SessionState>) {
  const next = { ...await readSession(appId), ...patch }
  await fs.mkdir(appDir(appId), { recursive: true })
  await fs.writeFile(sessionFile(appId), JSON.stringify(next, null, 2))
  return next
}

// --- Spotting a sign-in page -------------------------------------------------------------------------------

const LOGIN_PATH = /(^|\/)(log-?in|sign-?in|sign_in|signin|auth|session\/new|users\/sign_in)(\/|$)/i

export function isLoginUrl(url: string) {
  try { return LOGIN_PATH.test(new URL(url).pathname) } catch { return false }
}

// True when the app showed its sign-in page instead of the page asked for: it redirected to a login path,
// or it rendered a sign-in form in place. Asking for the login page itself is never "signed out".
export async function landedOnSignIn(page: Page, requested: string) {
  if (isLoginUrl(requested)) return false
  if (isLoginUrl(page.url())) return true
  return page.evaluate(() => {
    const pw = Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const heading = `${document.title} ${Array.from(document.querySelectorAll('h1, h2')).map(h => h.textContent).join(' ')}`
    return pw && /\b(sign ?in|log ?in|login)\b/i.test(heading)
  }).catch(() => false)
}

// --- Saved login --------------------------------------------------------------------------------------------

// Windows DPAPI with the current-user scope: only this Windows account on this machine can decrypt it. The
// secret travels to PowerShell on stdin, never on a command line or in the environment.
const DPAPI = (fn: 'Protect' | 'Unprotect') => `
  Add-Type -AssemblyName System.Security
  $in = [Console]::In.ReadToEnd().Trim()
  $out = [Security.Cryptography.ProtectedData]::${fn}([Convert]::FromBase64String($in), $null, 'CurrentUser')
  [Console]::Out.Write([Convert]::ToBase64String($out))
`

export const savedLoginSupported = process.platform === 'win32'

function dpapi(fn: 'Protect' | 'Unprotect', b64: string) {
  return new Promise<string>((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(DPAPI(fn), 'utf16le').toString('base64')], { windowsHide: true })
    let out = '', err = ''
    ps.stdout.on('data', d => (out += d))
    ps.stderr.on('data', d => (err += d))
    ps.on('error', reject)
    ps.on('close', code => code === 0 && out ? resolve(out.trim()) : reject(new Error(err.trim().split('\n')[0] || 'Windows could not encrypt the password')))
    ps.stdin.end(b64)
  })
}

export async function getSavedLogin(appId: string): Promise<{ user: string } | null> {
  try {
    const j = JSON.parse(await fs.readFile(loginFile(appId), 'utf8'))
    return j.user ? { user: j.user } : null
  } catch { return null }
}

export async function saveLogin(appId: string, user: string, password: string) {
  if (!savedLoginSupported) throw createError({ statusCode: 422, message: 'Saved logins are only available on Windows' })
  if (!user.trim() || !password) throw createError({ statusCode: 422, message: 'Enter both the email (or username) and the password' })
  const secret = await dpapi('Protect', Buffer.from(password, 'utf8').toString('base64'))
  await fs.mkdir(appDir(appId), { recursive: true })
  await fs.writeFile(loginFile(appId), JSON.stringify({ user: user.trim(), secret }))
  return { user: user.trim() }
}

export async function removeLogin(appId: string) {
  await fs.rm(loginFile(appId), { force: true })
}

async function loadLogin(appId: string) {
  try {
    const j = JSON.parse(await fs.readFile(loginFile(appId), 'utf8'))
    if (!j.user || !j.secret) return null
    return { user: String(j.user), password: Buffer.from(await dpapi('Unprotect', j.secret), 'base64').toString('utf8') }
  } catch { return null }
}

// Fills the sign-in form the page is showing with the saved login, ticks "remember me" when there is one, and
// submits. Throws with a reason a non-developer can act on.
export async function signInWithSavedLogin(appId: string, page: Page) {
  const login = await loadLogin(appId)
  if (!login) throw new Error('no saved login')
  const fields = await page.evaluate(() => {
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const pw = Array.from(document.querySelectorAll('input[type="password"]')).find(shown)
    if (!pw) return null
    const candidates = Array.from(document.querySelectorAll('input')).filter(el => shown(el) && /^(email|text|tel)$|^$/.test(el.type))
    const user = candidates.find(el => /email|user|login/i.test(`${el.type} ${el.name} ${el.id} ${el.autocomplete}`)) ?? candidates[0]
    pw.setAttribute('data-bower-pw', '1')
    user?.setAttribute('data-bower-user', '1')
    const remember = Array.from(document.querySelectorAll('input[type="checkbox"]')).find((el) => {
      const label = (el.closest('label')?.textContent || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.getAttribute('name') || '')
      return /remember/i.test(label)
    }) as HTMLInputElement | undefined
    if (remember && !remember.checked) remember.setAttribute('data-bower-remember', '1')
    return { user: !!user }
  })
  if (!fields) throw new Error('the sign-in page has no password field Bower can fill in')
  const fill = async (sel: string, value: string) => {
    const el = await page.$(sel)
    if (!el) return
    await el.click({ count: 3 })
    await page.keyboard.press('Backspace')
    await page.keyboard.type(value, { delay: 10 })
  }
  if (fields.user) await fill('[data-bower-user]', login.user)
  await fill('[data-bower-pw]', login.password)
  const remember = await page.$('[data-bower-remember]')
  if (remember) await remember.click().catch(() => {})
  const before = page.url()
  await page.focus('[data-bower-pw]')
  await page.keyboard.press('Enter')
  await Promise.race([page.waitForNavigation({ timeout: 15_000 }).catch(() => {}), page.waitForFunction(u => location.href !== u, { timeout: 15_000 }, before).catch(() => {})])
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => {})
  const stillThere = isLoginUrl(page.url()) || await page.$('input[type="password"]').then(h => !!h)
  if (stillThere) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => '')
    if (/code|two.?factor|2fa|verify|captcha|robot/i.test(text)) throw new Error('the app asked for a code or a check Bower cannot answer. Sign in by hand with Open browser instead')
    throw new Error('the app did not accept the saved login. Check the email and password in Settings, App')
  }
}
