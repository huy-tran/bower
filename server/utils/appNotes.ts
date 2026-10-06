import { requireClaude, spawnClaude } from './claudeBin'
import { createInterface } from 'node:readline'
import { readSession } from './session'
import { updateApp } from './apps'
import { lightModel } from './models'
import { describeNetError, projectApp, withProfile } from './shots'
import { projectDir } from './store'
import { trackClaudeEvent } from './usage'

// "Getting around" notes written by Claude: Bower walks the signed-in app's menus (headless, on the project's
// profile), collects each page's title, headings, buttons and table columns, and Claude turns that into a short
// map of the app. Claude itself never browses: it only sees what Bower collected.
interface PageInfo { path: string, link: string, title: string, headings: string[], buttons: string[], columns: string[] }
export interface NotesJob { status: 'running' | 'done' | 'error', startedAt: number, activity: string[], error?: string }

const jobs = new Map<string, NotesJob>()
const MAX_PAGES = 14
const TIMEOUT_MS = 4 * 60 * 1000

export function getNotesJob(pid: string) {
  const j = jobs.get(pid)
  return j ? { status: j.status, startedAt: j.startedAt, activity: j.activity.slice(-4), error: j.error } : null
}

async function crawl(appId: string, base: string, start: string, job: NotesJob) {
  const origin = new URL(base).origin
  return withProfile(appId, async (browser) => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    try { await page.goto(start, { waitUntil: 'networkidle2', timeout: 45_000 }) } catch (e) { throw new Error(describeNetError(e, start)) }
    // The menus: links in navigation, sidebars and headers, same site only.
    const links = await page.evaluate((origin) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim()
      const out: { href: string, text: string }[] = []
      for (const a of Array.from(document.querySelectorAll('nav a[href], aside a[href], header a[href], [role="navigation"] a[href], [class*="sidebar" i] a[href]')) as HTMLAnchorElement[]) {
        const href = a.href.split('#')[0]!
        const text = norm(a.getAttribute('aria-label')) || norm(a.innerText)
        if (!href.startsWith(origin) || !text || text.length > 60 || /log ?out|sign ?out/i.test(text)) continue
        if (!out.some(o => o.href === href)) out.push({ href, text })
      }
      return out
    }, origin)
    const pages: PageInfo[] = []
    const targets = [{ href: page.url(), text: 'Start page' }, ...links.filter(l => l.href !== page.url())].slice(0, MAX_PAGES)
    for (const t of targets) {
      job.activity.push(`Looking at ${new URL(t.href).pathname}`)
      try {
        if (page.url() !== t.href) await page.goto(t.href, { waitUntil: 'networkidle2', timeout: 30_000 })
        const info = await page.evaluate(() => {
          const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim()
          const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
          const texts = (sel: string, n: number) => Array.from(new Set(Array.from(document.querySelectorAll(sel)).filter(shown).map(e => norm((e as HTMLElement).innerText || e.getAttribute('aria-label'))).filter(t => t && t.length <= 50))).slice(0, n)
          return { title: document.title, headings: texts('main h1, main h2, h1, h2', 5), buttons: texts('main button, main a[role="button"], main [type="submit"], button', 12), columns: texts('th', 10) }
        })
        pages.push({ path: new URL(page.url()).pathname + new URL(page.url()).search, link: t.text, ...info })
      } catch {}
    }
    return { pages, menu: links.map(l => l.text) }
  })
}

export async function startNotes(pid: string) {
  if (jobs.get(pid)?.status === 'running') return getNotesJob(pid)!
  const { app } = await projectApp(pid)
  const job: NotesJob = { status: 'running', startedAt: Date.now(), activity: ['Opening the app…'] }
  jobs.set(pid, job)
  const session = await readSession(app.id)
  const start = session.home && session.home.startsWith(new URL(app.url).origin) ? session.home : app.url

  ;(async () => {
    const found = await crawl(app.id, app.url, start, job)
    if (!found.pages.length) throw new Error('Bower could not open any page of the app')
    if (found.pages.every(pg => /sign ?in|log ?in/i.test(pg.title))) throw new Error('Every page showed the sign-in screen. Sign in first (Open browser), then try again')
    job.activity.push('Claude is writing the notes…')
    const bin = await requireClaude()
    const prompt = [
      'Below is what Bower found by walking the menus of a web app: each page\'s path, the menu label that leads there, its title,',
      'headings, buttons and table columns. Write short "getting around" notes for another AI that will capture screenshots of this',
      'app for product videos. It needs to know which page to open for what, and the names of the main buttons and sections.',
      '',
      'Terse bullet points, one line each, at most 12 bullets and 900 characters in total. Use the real paths and labels.',
      'Group by area when it helps. Mention pages that look risky to use (deleting, billing, sending emails) so they are avoided.',
      'Only state what the data shows: do not guess what a button opens or does.',
      'Output only the bullets, each starting with "- ", with no heading or preamble.',
      '',
      JSON.stringify(found)
    ].join('\n')
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'Read', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Agent,Glob,Grep', '--model', lightModel('haiku')]
    const text = await new Promise<string>((resolve, reject) => {
      const proc = spawnClaude(bin, args, { cwd: projectDir(pid), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let out = '', isError = false, stderr = ''
      const timer = setTimeout(() => proc.kill(), TIMEOUT_MS)
      createInterface({ input: proc.stdout }).on('line', (line) => {
        try { const ev = JSON.parse(line); trackClaudeEvent(pid, 'notes', ev); if (ev.type === 'result') { out = String(ev.result ?? ''); isError = !!ev.is_error } } catch {}
      })
      proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('error', reject)
      proc.on('close', (code) => {
        clearTimeout(timer)
        if (isError || !out.trim()) reject(new Error(out.trim() || stderr.trim().split('\n').slice(-2).join(' ') || `claude exited with code ${code}`))
        else resolve(out.trim())
      })
      proc.stdin.end(prompt)
    })
    // The notes belong to the shared app, so every project about it gets them.
    await updateApp(app.id, { notes: text.slice(0, 2000) })
    job.status = 'done'
  })().catch((e) => {
    job.status = 'error'
    job.error = String(e?.message || e)
  })
  return getNotesJob(pid)!
}
