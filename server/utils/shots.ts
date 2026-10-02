import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import puppeteer, { type Browser, type HTTPResponse, type Page } from 'puppeteer'
import { CHROME_ARGS } from './browser'
import { getSavedLogin, isLoginUrl, landedOnSignIn, readSession, signInWithSavedLogin, updateSession } from './session'
import { showBrowserWindow } from './showWindow'
import { hasShotStep, installFinder, parseSteps, runSteps, StepError, type Step } from './steps'
import { appDir } from './apps'
import { loadProject, projectDir, slugify } from './store'

// Screenshots of the running product. Each shared app (apps.ts) keeps one Chrome profile, so the user signs in
// once in a visible window and later headless captures for every project about that app reuse the session.
// Nothing is stored about the login itself beyond what Chrome keeps in the profile (and an optional saved
// login, see session.ts). Screenshots themselves belong to the project that took them.
export const profileDir = (appId: string) => join(appDir(appId), 'browser')
const shotsDir = (pid: string) => join(projectDir(pid), 'assets', 'shots')
// Visible windows on the profile: the sign-in window or a step recording. Chrome cannot share a profile, so
// while one is open, headless work on that app waits for the user to close it. Keyed by app id.
const visible = new Map<string, { browser: Browser, kind: 'login' | 'record' }>()

export const SHOT_SIZES: Record<string, { width: number, height: number }> = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1194 },
  mobile: { width: 390, height: 844 }
}

// Visible windows (sign-in, step recording). BOWER_TEST_WINDOWS=headless runs them headless on debugging port
// 9333 instead, so automated tests can drive them without taking over the screen.
export function launchVisible(appId: string, width: number) {
  const test = process.env.BOWER_TEST_WINDOWS === 'headless'
  return puppeteer.launch({ headless: test, userDataDir: profileDir(appId), defaultViewport: test ? { width, height: 900 } : null, args: test ? ['--remote-debugging-port=9333'] : [`--window-size=${width},900`] })
}
export async function showVisible(browser: Browser) {
  if (process.env.BOWER_TEST_WINDOWS !== 'headless') await showBrowserWindow(browser.process()?.pid)
}

export function resolveTarget(base: string, target: string) {
  const t = target.trim()
  if (/^https?:\/\//i.test(t)) return t
  return `${base}/${t.replace(/^\//, '')}`
}

// The project's shared app, or a plain error when it has none.
export async function projectApp(pid: string) {
  const p = await loadProject(pid)
  if (!p.app) throw createError({ statusCode: 422, message: 'Choose or add the app first, in Settings, App' })
  return { p, app: p.app }
}

export async function loginOpen(pid: string) {
  const p = await loadProject(pid)
  return !!p.app && visible.has(p.app.id)
}

export function visibleKind(appId: string) {
  return visible.get(appId)?.kind ?? null
}

export function claimVisible(appId: string, browser: Browser, kind: 'login' | 'record') {
  visible.set(appId, { browser, kind })
  browser.on('disconnected', () => { if (visible.get(appId)?.browser === browser) visible.delete(appId) })
}

// One headless browser per app at a time: Claude's captures, connection checks and crawls queue up instead
// of failing because the profile is in use.
const queues = new Map<string, Promise<unknown>>()
export function withProfile<T>(appId: string, fn: (browser: Browser) => Promise<T>): Promise<T> {
  const run = async () => {
    if (visible.has(appId)) throw createError({ statusCode: 409, message: visible.get(appId)!.kind === 'record' ? 'A step recording is open. Finish it first; Chrome cannot use the profile twice at once' : 'Close the sign-in window first; Chrome cannot use the profile twice at once' })
    await fs.mkdir(profileDir(appId), { recursive: true })
    const browser = await puppeteer.launch({ headless: true, userDataDir: profileDir(appId), args: CHROME_ARGS })
    try { return await fn(browser) } finally { await browser.close().catch(() => {}) }
  }
  const next = (queues.get(appId) ?? Promise.resolve()).catch(() => {}).then(run)
  queues.set(appId, next)
  return next
}

// Chrome's network errors in words a non-developer can act on.
export function describeNetError(err: unknown, url: string) {
  const m = String((err as Error)?.message || err)
  const host = (() => { try { return new URL(url).host } catch { return url } })()
  if (/ERR_NAME_NOT_RESOLVED/.test(m)) return `Can't find ${host}. Check the spelling, and that the site is running (for a .test address, that Herd is running).`
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED/.test(m)) return `Nothing is answering at ${host}. Is the site running?`
  if (/ERR_CERT|SSL/.test(m)) return `${host} has a security certificate problem. Try the http:// address, or ask a developer to fix the certificate.`
  if (/timeout|ERR_TIMED_OUT/i.test(m)) return `${host} took too long to answer. It may be busy or stuck.`
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(m)) return 'This computer seems to be offline.'
  return `Could not open ${url}: ${m.replace(/^.*?(net::)/, '$1').split('\n')[0]}`
}

async function open(page: Page, url: string) {
  try {
    return await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
  } catch (e) {
    throw createError({ statusCode: 502, message: describeNetError(e, url) })
  }
}

const signedOutMessage = (app: string, url: string) => {
  const path = (() => { try { return new URL(url).pathname } catch { return url } })()
  return `Bower is signed out of the app: ${app} showed its sign-in page instead of ${path}. Sign in again in Settings, App (Open browser), or save a login there so Bower can sign in by itself.`
}

// After loading a page: if the app sent us to its sign-in page, sign in with the saved login and load the page
// again, or stop with a clear message. Never saves a picture of the login screen by accident.
async function ensureSignedIn(appId: string, app: string, page: Page, url: string) {
  if (!await landedOnSignIn(page, url)) return
  // This page needs sign-in, so it is a good one to check the session against later.
  await updateSession(appId, { home: url })
  if (!await getSavedLogin(appId)) {
    await updateSession(appId, { signedIn: false, checkedAt: new Date().toISOString() })
    throw createError({ statusCode: 401, message: signedOutMessage(app, url) })
  }
  try {
    await signInWithSavedLogin(appId, page)
  } catch (e) {
    await updateSession(appId, { signedIn: false, checkedAt: new Date().toISOString(), error: `Saved login: ${(e as Error).message}` })
    throw createError({ statusCode: 401, message: `Bower is signed out of the app, and signing in with the saved login failed: ${(e as Error).message}.` })
  }
  await open(page, url)
  if (await landedOnSignIn(page, url)) throw createError({ statusCode: 401, message: signedOutMessage(app, url) })
  await updateSession(appId, { signedIn: true, checkedAt: new Date().toISOString(), error: undefined })
}

// A visible browser window on the user's own session, so they can sign in. Closing it keeps the session, and
// the page it was left on becomes the page Bower checks the session against.
export async function openLogin(pid: string, target?: string) {
  const { app } = await projectApp(pid)
  if (visible.has(app.id)) return { open: true }
  await fs.mkdir(profileDir(app.id), { recursive: true })
  const browser = await launchVisible(app.id, 1280)
  claimVisible(app.id, browser, 'login')
  const origin = new URL(app.url).origin
  let last = '', sawLogin = false
  browser.on('targetchanged', (t) => {
    const u = t.url()
    if (t.type() !== 'page' || !u.startsWith(origin)) return
    if (isLoginUrl(u)) sawLogin = true
    else last = u
  })
  browser.on('disconnected', () => {
    // Only a page reached after the sign-in page, or one deeper than the home page, says something about the session.
    if (last && (sawLogin || new URL(last).pathname !== '/')) updateSession(app.id, { home: last, signedIn: true, checkedAt: new Date().toISOString(), error: undefined }).catch(() => {})
  })
  const page = (await browser.pages())[0] ?? await browser.newPage()
  await page.goto(resolveTarget(app.url, target || ''), { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await showVisible(browser)
  return { open: true }
}

export async function closeLogin(pid: string) {
  const p = await loadProject(pid)
  if (!p.app) return
  await visible.get(p.app.id)?.browser.close().catch(() => {})
  visible.delete(p.app.id)
}

export interface CheckResult { reachable: boolean, status?: number, signedIn: boolean | null, autoSignedIn?: boolean, page?: string, title?: string, error?: string, checkedAt: string, loginOpen?: boolean }

// "Test connection": can Bower reach the app, and is it signed in? Checks the page the sign-in window was left
// on (a page that needs sign-in), or the app address when there is none yet.
export async function checkApp(pid: string): Promise<CheckResult> {
  const { app } = await projectApp(pid)
  const at = () => new Date().toISOString()
  if (visible.has(app.id)) return { reachable: true, signedIn: null, checkedAt: at(), loginOpen: true }
  const session = await readSession(app.id)
  const url = session.home && session.home.startsWith(new URL(app.url).origin) ? session.home : app.url
  const result = await withProfile(app.id, async (browser) => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    let res: HTTPResponse | null
    try {
      res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 })
    } catch (e) {
      return { reachable: false, signedIn: null, error: describeNetError(e, url), checkedAt: at() } as CheckResult
    }
    const status = res?.status() ?? 0
    const title = await page.title().catch(() => '')
    if (status >= 500) return { reachable: true, status, signedIn: null, page: page.url(), title, error: `The site answered with an error (${status}). It may be broken right now; a developer can check its logs.`, checkedAt: at() } as CheckResult
    if (await landedOnSignIn(page, url)) {
      if (!await getSavedLogin(app.id)) return { reachable: true, status, signedIn: false, page: page.url(), title, checkedAt: at() } as CheckResult
      try {
        await signInWithSavedLogin(app.id, page)
        return { reachable: true, status, signedIn: true, autoSignedIn: true, page: page.url(), title: await page.title().catch(() => ''), checkedAt: at() } as CheckResult
      } catch (e) {
        return { reachable: true, status, signedIn: false, page: page.url(), title, error: `Signing in with the saved login failed: ${(e as Error).message}.`, checkedAt: at() } as CheckResult
      }
    }
    // Without a known page behind the sign-in, a page that loads fine only says the site is up.
    return { reachable: true, status, signedIn: session.home ? true : null, page: page.url(), title, error: status >= 400 ? `The page answered ${status}.` : undefined, checkedAt: at() } as CheckResult
  })
  await updateSession(app.id, { reachable: result.reachable, signedIn: result.signedIn ?? undefined, checkedAt: result.checkedAt, error: result.error, title: result.title })
  return result
}

export interface ShotOptions { target: string, size?: string, width?: number, height?: number, fullPage?: boolean, scale?: number, name?: string, steps?: Step[] | string }

export interface Shot { name: string, path: string, url: string, page: string, title: string, width: number, height: number, fullPage: boolean, at: string }

// Opens the page, runs the steps (see steps.ts) and saves a PNG for each `shot` step, or one at the end when
// there is none. A failing step still saves a PNG of where the page got to, so Claude can see what went wrong.
export async function captureShot(pid: string, opts: ShotOptions) {
  const { app: shared } = await projectApp(pid)
  const app = shared.url
  const steps = parseSteps(opts.steps)
  const preset = SHOT_SIZES[opts.size ?? ''] ?? SHOT_SIZES.desktop!
  const width = Math.min(3000, Math.max(320, Math.round(opts.width || preset.width)))
  const height = Math.min(3000, Math.max(320, Math.round(opts.height || preset.height)))
  const scale = opts.scale === 1 ? 1 : 2
  const resolve = (t: string) => resolveTarget(app, t)
  const url = resolve(opts.target || '/')
  await fs.mkdir(shotsDir(pid), { recursive: true })

  return withProfile(shared.id, async (browser) => {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: scale })
    await installFinder(page)
    await open(page, url)
    await ensureSignedIn(shared.id, app, page, url)
    await new Promise(r => setTimeout(r, 600)) // let entrance animations settle

    const shots: Shot[] = []
    const save = async (label: string, fullPage: boolean) => {
      const buf = await page.screenshot({ type: 'png', fullPage })
      const base = slugify(label || new URL(page.url()).pathname.replace(/\/$/, '') || 'home').slice(0, 40) || 'home'
      const name = `${base}-${randomBytes(2).toString('hex')}.png`
      await fs.writeFile(join(shotsDir(pid), name), buf)
      const title = await page.title().catch(() => '')
      const shot: Shot = { name, path: `assets/shots/${name}`, url: `/api/projects/${pid}/files/assets/shots/${name}`, page: page.url(), title, width, height, fullPage, at: new Date().toISOString() }
      shots.push(shot)
      return shot
    }
    try {
      await runSteps(page, steps, { resolve, shot: async (name, full) => { await save(name, full) }, navigated: u => ensureSignedIn(shared.id, app, page, u) })
    } catch (e) {
      if (!(e instanceof StepError)) throw e
      const done = [...shots]
      const failed = await save(`${slugify(opts.name || 'step')}-failed`, false).catch(() => null)
      throw createError({
        statusCode: 422,
        message: `${e.message.replace(/\.?$/, '.')}${failed ? ` The page at that point: ${failed.path} (Read it to see).` : ''}${done.length ? ` Saved before the failure: ${done.map(s => s.path).join(', ')}.` : ''}`,
        data: { step: e.index + 1, failed: failed?.path, shots: done }
      })
    }
    if (!hasShotStep(steps)) await save(opts.name || '', !!opts.fullPage)
    return { shots, page: page.url(), title: shots[shots.length - 1]!.title, width, height, steps: steps.length }
  })
}

export async function listShots(pid: string) {
  const dir = shotsDir(pid)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out = await Promise.all(names.filter(n => n.endsWith('.png')).map(async (name) => {
    const st = await fs.stat(join(dir, name))
    return { name, path: `assets/shots/${name}`, url: `/api/projects/${pid}/files/assets/shots/${name}`, at: st.mtime.toISOString(), bytes: st.size }
  }))
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export async function removeShot(pid: string, name: string) {
  if (!/^[\w.-]+\.png$/.test(name)) throw createError({ statusCode: 404 })
  await fs.rm(join(shotsDir(pid), name), { force: true })
  return listShots(pid)
}
