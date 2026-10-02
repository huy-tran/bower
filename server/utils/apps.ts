import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { STORAGE } from './paths'

// The running product, defined once and shared by every project about it, like a brand kit: its address,
// notes on getting around, its repositories, and everything about being signed in to it (the Chrome profile,
// session.json and an optional saved login, see session.ts). One sign-in then covers every video of the app.
// Kept free of store.ts imports (store hydrates projects from here).
export const APPS_DIR = resolve(STORAGE, '..', 'apps')

export interface AppRepo { label: string, path: string, notes: string }
export interface SharedApp { id: string, name: string, url: string, notes: string, codebases: AppRepo[], createdAt: string }

const isId = (id: string) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(id)
export const appDir = (id: string) => {
  if (!isId(id)) throw createError({ statusCode: 404, message: 'App not found' })
  return join(APPS_DIR, id)
}
const appFile = (id: string) => join(appDir(id), 'app.json')

// "http://Example.test/" and "http://example.test" are the same app.
export function normalizeUrl(raw: string) {
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw createError({ statusCode: 422, message: 'The app address must be a full URL, like http://localhost:8000' }) }
  if (!/^https?:$/.test(u.protocol)) throw createError({ statusCode: 422, message: 'The app address must start with http:// or https://' })
  return u.toString().replace(/\/$/, '')
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'app'

export async function getApp(id: string): Promise<SharedApp | null> {
  try { return JSON.parse(await fs.readFile(appFile(id), 'utf8')) } catch { return null }
}

export async function listApps(): Promise<SharedApp[]> {
  const ids = await fs.readdir(APPS_DIR).catch(() => [] as string[])
  const apps = await Promise.all(ids.filter(isId).map(getApp))
  return apps.filter((a): a is SharedApp => !!a).sort((a, b) => a.name.localeCompare(b.name))
}

async function writeApp(a: SharedApp) {
  await fs.mkdir(appDir(a.id), { recursive: true })
  await fs.writeFile(appFile(a.id), JSON.stringify(a, null, 2))
  return a
}

// Reuses the app with the same address, so two projects about one product never get two sign-ins.
export async function createApp(input: { url: string, name?: string, notes?: string }) {
  const url = normalizeUrl(input.url)
  const same = (await listApps()).find(a => a.url.toLowerCase() === url.toLowerCase())
  if (same) return same
  const host = new URL(url).host.replace(/^www\./, '')
  let id = slug(host)
  while (existsSync(join(APPS_DIR, id))) id = `${slug(host)}-${randomBytes(2).toString('hex')}`
  return writeApp({ id, name: (input.name || '').trim().slice(0, 60) || host, url, notes: String(input.notes ?? '').slice(0, 2000), codebases: [], createdAt: new Date().toISOString() })
}

export async function updateApp(id: string, patch: Partial<Pick<SharedApp, 'name' | 'url' | 'notes' | 'codebases'>>) {
  const a = await getApp(id)
  if (!a) throw createError({ statusCode: 404, message: 'App not found' })
  if (patch.name !== undefined) a.name = String(patch.name).trim().slice(0, 60) || a.name
  if (patch.url !== undefined) a.url = normalizeUrl(patch.url)
  if (patch.notes !== undefined) a.notes = String(patch.notes).slice(0, 2000)
  if (patch.codebases !== undefined) a.codebases = patch.codebases
  return writeApp(a)
}

// Which projects use each app, read straight from project.json files.
export async function appUsage(): Promise<Map<string, { id: string, name: string }[]>> {
  const out = new Map<string, { id: string, name: string }[]>()
  for (const pid of await fs.readdir(STORAGE).catch(() => [] as string[])) {
    try {
      const p = JSON.parse(await fs.readFile(join(STORAGE, pid, 'project.json'), 'utf8'))
      if (p.appId) out.set(p.appId, [...out.get(p.appId) ?? [], { id: pid, name: p.name }])
    } catch {}
  }
  return out
}

export async function deleteApp(id: string) {
  const users = (await appUsage()).get(id) ?? []
  if (users.length) throw createError({ statusCode: 409, message: `Still used by ${users.map(u => `"${u.name}"`).join(', ')}. Pick another app (or none) in those projects first.` })
  await fs.rm(appDir(id), { recursive: true, force: true })
}

// Projects from before shared apps kept the app, its Chrome profile, session and saved login themselves. The
// first time such a project loads it is linked to the shared app with the same address (created if needed),
// and its sign-in moves over when the app has none yet. One migration per project at a time.
const migrating = new Map<string, Promise<string | null>>()
export function migrateLegacyApp(pid: string, raw: { app?: { url?: string, notes?: string } | null }) {
  const running = migrating.get(pid)
  if (running) return running
  const job = (async () => {
    if (!raw.app?.url) return null
    let app: SharedApp
    try { app = await createApp({ url: raw.app.url, notes: raw.app.notes }) } catch { return null }
    if (!app.notes && raw.app.notes) app = await updateApp(app.id, { notes: raw.app.notes })
    const from = join(STORAGE, pid, '.bower')
    for (const name of ['browser', 'session.json', 'login.json']) {
      const src = join(from, name), dst = join(appDir(app.id), name)
      if (existsSync(src) && !existsSync(dst)) await fs.rename(src, dst).catch(() => fs.cp(src, dst, { recursive: true }).catch(() => {}))
    }
    const file = join(STORAGE, pid, 'project.json')
    const p = JSON.parse(await fs.readFile(file, 'utf8'))
    p.appId = app.id
    p.appMode = p.app?.mode ?? 'auto'
    delete p.app
    await fs.writeFile(file, JSON.stringify(p, null, 2))
    return app.id
  })().finally(() => migrating.delete(pid))
  migrating.set(pid, job)
  return job
}

// Repositories as sent by the editor, checked: each path must be a folder on this machine. Shared by projects
// (their own repos) and apps.
export async function cleanRepos(list: unknown[]): Promise<AppRepo[]> {
  const next: AppRepo[] = []
  for (const c of list.slice(0, 8) as any[]) {
    const path = String(c?.path ?? '').trim()
    if (!path) continue
    const abs = resolve(path)
    const st = await fs.stat(abs).catch(() => null)
    if (!st?.isDirectory()) throw createError({ statusCode: 422, message: `"${path}" is not a folder on this machine` })
    if (next.some(x => x.path.toLowerCase() === abs.toLowerCase())) continue
    const label = String(c?.label ?? '').trim().slice(0, 40) || basename(abs)
    next.push({ label, path: abs, notes: String(c?.notes ?? '').slice(0, 2000) })
  }
  return next
}
