import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import puppeteer, { type Browser } from 'puppeteer'
import { CHROME_ARGS } from './browser'
import { showBrowserWindow } from './showWindow'
import { hasShotStep, installFinder, parseSteps, runSteps, StepError, type Step } from './steps'
import { loadProject, projectDir, slugify } from './store'

// Screenshots of the running product. Each project keeps its own Chrome profile under .bower/browser, so the
// user logs in once in a visible window and later headless captures reuse that session. Nothing is stored
// about the login itself beyond what Chrome keeps in the profile.
const profileDir = (pid: string) => join(projectDir(pid), '.bower', 'browser')
const shotsDir = (pid: string) => join(projectDir(pid), 'assets', 'shots')
const logins = new Map<string, Browser>()

export const SHOT_SIZES: Record<string, { width: number, height: number }> = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1194 },
  mobile: { width: 390, height: 844 }
}

function resolveTarget(base: string, target: string) {
  const t = target.trim()
  if (/^https?:\/\//i.test(t)) return t
  return `${base}/${t.replace(/^\//, '')}`
}

export function loginOpen(pid: string) {
  return logins.has(pid)
}

// A visible browser window on the user's own session, so they can sign in. Closing it keeps the session.
export async function openLogin(pid: string, target?: string) {
  const p = await loadProject(pid)
  if (!p.app) throw createError({ statusCode: 422, message: 'Set the app address first' })
  if (logins.has(pid)) return { open: true }
  await fs.mkdir(profileDir(pid), { recursive: true })
  const browser = await puppeteer.launch({ headless: false, userDataDir: profileDir(pid), defaultViewport: null, args: ['--window-size=1280,900'] })
  logins.set(pid, browser)
  browser.on('disconnected', () => logins.delete(pid))
  const page = (await browser.pages())[0] ?? await browser.newPage()
  await page.goto(resolveTarget(p.app.url, target || ''), { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {})
  await showBrowserWindow(browser.process()?.pid)
  return { open: true }
}

export async function closeLogin(pid: string) {
  await logins.get(pid)?.close().catch(() => {})
  logins.delete(pid)
}

export interface ShotOptions { target: string, size?: string, width?: number, height?: number, fullPage?: boolean, scale?: number, name?: string, steps?: Step[] | string }

export interface Shot { name: string, path: string, url: string, page: string, title: string, width: number, height: number, fullPage: boolean, at: string }

// Opens the page, runs the steps (see steps.ts) and saves a PNG for each `shot` step, or one at the end when
// there is none. A failing step still saves a PNG of where the page got to, so Claude can see what went wrong.
export async function captureShot(pid: string, opts: ShotOptions) {
  const p = await loadProject(pid)
  if (!p.app) throw createError({ statusCode: 422, message: 'Set the app address in Settings, App first' })
  if (logins.has(pid)) throw createError({ statusCode: 409, message: 'Close the login window first; Chrome cannot use the profile twice at once' })
  const steps = parseSteps(opts.steps)
  const preset = SHOT_SIZES[opts.size ?? ''] ?? SHOT_SIZES.desktop!
  const width = Math.min(3000, Math.max(320, Math.round(opts.width || preset.width)))
  const height = Math.min(3000, Math.max(320, Math.round(opts.height || preset.height)))
  const scale = opts.scale === 1 ? 1 : 2
  const resolve = (t: string) => resolveTarget(p.app!.url, t)
  const url = resolve(opts.target || '/')
  await fs.mkdir(profileDir(pid), { recursive: true })
  await fs.mkdir(shotsDir(pid), { recursive: true })

  const browser = await puppeteer.launch({ headless: true, userDataDir: profileDir(pid), args: CHROME_ARGS })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: scale })
    await installFinder(page)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
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
      await runSteps(page, steps, { resolve, shot: async (name, full) => { await save(name, full) } })
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
  } finally {
    await browser.close().catch(() => {})
  }
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
