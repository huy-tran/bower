import { requireClaude, spawnClaude } from './claudeBin'
import { createInterface } from 'node:readline'
import { updateApp } from './apps'
import { lightModel } from './models'
import { allCodebases, loadProject, saveProject } from './store'

// "Where to look" notes written by Claude itself: it reads a linked repository (read-only) and returns a short
// orientation note, which is saved where the repo is linked: on the shared app or on the project. One scan per
// repo at a time.
export interface ScanJob { status: 'running' | 'done' | 'error', startedAt: number, activity: string[], error?: string }

const jobs = new Map<string, ScanJob>()
const TIMEOUT_MS = 6 * 60 * 1000
const key = (pid: string, path: string) => `${pid}:${path.toLowerCase()}`

const PROMPT = `Scan this repository and write a short orientation note for another AI that will later make product videos
from it. That AI needs to know where to look, not how the code works. Give it terse bullet points, one line each,
at most 12 bullets and 900 characters in total, using real paths relative to the repository root:

- the stack and framework, in a few words
- where screens or pages live
- where reusable UI components live
- where design tokens live (colours, fonts, spacing: Tailwind config, CSS variables, theme files)
- where user-facing copy or translations live
- for an API: where routes, models, resources or serializers and response shapes live
- brand assets (logos, icons, illustrations)
- folders to ignore

Skip anything that does not apply. Output only the bullets, each starting with "- ", with no heading or preamble.`

export function getScan(pid: string, path: string) {
  const j = jobs.get(key(pid, path))
  return j ? { status: j.status, startedAt: j.startedAt, activity: j.activity.slice(-5), error: j.error } : null
}

export async function startScan(pid: string, path: string) {
  const k = key(pid, path)
  if (jobs.get(k)?.status === 'running') return getScan(pid, path)!
  const p = await loadProject(pid)
  const repo = allCodebases(p).find(c => c.path.toLowerCase() === path.toLowerCase())
  if (!repo) throw createError({ statusCode: 404, message: 'That repository is not linked to this project' })
  const bin = await requireClaude()

  const job: ScanJob = { status: 'running', startedAt: Date.now(), activity: ['Starting Claude…'] }
  jobs.set(k, job)

  // Read-only: Claude may look but not touch, and it works inside the repo so its own CLAUDE.md applies.
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--allowedTools', 'Read,Glob,Grep',
    '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Agent',
    '--add-dir', repo.path,
    '--model', lightModel('sonnet')
  ]
  const proc = spawnClaude(bin, args, { cwd: repo.path, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  proc.stdin.end(PROMPT)

  let text = ''
  let isError = false
  let stderr = ''
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS)
  const short = (f: unknown) => String(f ?? '').replace(repo.path, '').replace(/^[\\/]/, '').replace(/\\/g, '/')

  createInterface({ input: proc.stdout }).on('line', (line) => {
    let ev: any
    try { ev = JSON.parse(line) } catch { return }
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type !== 'tool_use') continue
        const verb = ({ Read: 'Reading', Glob: 'Listing', Grep: 'Searching' } as Record<string, string>)[c.name] || c.name
        job.activity.push(`${verb} ${short(c.input?.file_path || c.input?.pattern || c.input?.path)}`.trim())
      }
    }
    if (ev.type === 'result') { text = String(ev.result ?? ''); isError = !!ev.is_error }
  })
  proc.stderr.on('data', (d) => { stderr += d.toString() })
  proc.on('error', (err) => { stderr += `\n${err.message}` })

  proc.on('close', async (code) => {
    clearTimeout(timer)
    const notes = text.trim().slice(0, 2000)
    if (!isError && notes) {
      try {
        const fresh = await loadProject(pid)
        const same = (c: { path: string }) => c.path.toLowerCase() === path.toLowerCase()
        const own = fresh.codebases.find(same)
        if (own) { own.notes = notes; await saveProject(fresh) }
        else if (fresh.app && fresh.appCodebases.some(same)) await updateApp(fresh.app.id, { codebases: fresh.appCodebases.map(c => same(c) ? { ...c, notes } : c) })
        job.status = 'done'
      } catch (e) {
        job.status = 'error'
        job.error = (e as Error).message
      }
    } else {
      job.status = 'error'
      job.error = text.trim() || stderr.trim().split('\n').slice(-3).join('\n') || `claude exited with code ${code}`
    }
  })

  return getScan(pid, path)!
}
