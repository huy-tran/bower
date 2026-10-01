import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { addVersion, blankScene, loadProject, newSceneId, projectDir, projectView, saveProject, sceneViews, writeScene } from './store'
import { trashScene } from './trash'

// Storyboard: Claude drafts a scene list from a brief (read-only, so it can consult CLAUDE.md, the brand kit and
// linked repos), the user edits it, then scenes are created with the brief and narration in their meta block.
export interface PlanScene { title: string, duration: number, brief: string, voice: string }
export interface PlanJob { status: 'running' | 'done' | 'error', startedAt: number, activity: string[], plan?: PlanScene[], error?: string }

const jobs = new Map<string, PlanJob>()
const TIMEOUT_MS = 6 * 60 * 1000

export function getPlan(pid: string) {
  const j = jobs.get(pid)
  return j ? { status: j.status, startedAt: j.startedAt, activity: j.activity.slice(-5), plan: j.plan, error: j.error } : null
}

function cleanPlan(raw: unknown): PlanScene[] {
  const list = Array.isArray(raw) ? raw : (raw as any)?.scenes
  if (!Array.isArray(list)) throw new Error('Claude did not return a scene list')
  const out = list.slice(0, 20).map((s: any) => ({
    title: String(s?.title ?? '').trim().slice(0, 80) || 'Scene',
    duration: Math.min(60000, Math.max(500, Math.round(Number(s?.duration) || 3000))),
    brief: String(s?.brief ?? s?.description ?? '').trim().slice(0, 1000),
    voice: String(s?.voice ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000)
  }))
  if (!out.length) throw new Error('Claude returned an empty storyboard')
  return out
}

export async function startPlan(pid: string, brief: string, opts: { seconds?: number, narration?: boolean } = {}) {
  if (jobs.get(pid)?.status === 'running') return getPlan(pid)!
  const p = await loadProject(pid)
  const views = await sceneViews(p)
  const seconds = Math.min(600, Math.max(5, Math.round(opts.seconds || 45)))
  const job: PlanJob = { status: 'running', startedAt: Date.now(), activity: ['Starting Claude…'] }
  jobs.set(pid, job)

  const prompt = [
    `Plan a motion-graphics video for the project "${p.name}" (${p.width}x${p.height} stage). Read CLAUDE.md first: it holds the art direction,`,
    'brand kit, linked codebases and the running product, and your plan must be grounded in them. Do not edit any file.',
    '',
    `Brief from the user:\n${brief.trim()}`,
    '',
    `Target length: about ${seconds} seconds in total. Use between 3 and 12 scenes; most scenes run 3 to 8 seconds.`,
    opts.narration
      ? 'Include a voice-over line for every scene, written to be spoken, at most 2.5 words per second of that scene. The lines must read as one continuous piece.'
      : 'No voice-over: leave "voice" empty for every scene.',
    views.length > 1 || views.some(v => v.brief) ? `For context, the project currently has these scenes: ${views.map(v => `"${v.title}" (${v.duration}ms)`).join(', ')}. The user may replace or keep them.` : '',
    '',
    'For each scene give: "title" (short), "duration" in milliseconds, "brief" (one to three sentences: what is on screen, how it moves,',
    'and what it should make the viewer feel; name real product screens, copy or data when the codebase or app provides them), and "voice".',
    'Order the scenes as they play. Open strong, build, and end with a clear close.',
    '',
    'Reply with JSON only, no prose, no code fence: {"scenes":[{"title":"...","duration":4000,"brief":"...","voice":"..."}]}'
  ].filter(l => l !== '').join('\n')

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--allowedTools', 'Read,Glob,Grep',
    '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Agent'
  ]
  for (const c of p.codebases) args.push('--add-dir', c.path)
  if (process.env.BOWER_MODEL) args.push('--model', process.env.BOWER_MODEL)
  const proc = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: projectDir(pid), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  proc.stdin.end(prompt)

  let text = ''
  let isError = false
  let stderr = ''
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS)
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let ev: any
    try { ev = JSON.parse(line) } catch { return }
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') job.activity.push(`Reading ${String(c.input?.file_path || c.input?.pattern || c.input?.path || '').replace(projectDir(pid), '').replace(/^[\\/]/, '').replace(/\\/g, '/')}`.trim())
        else if (c.type === 'text' && c.text?.trim()) job.activity.push('Writing the plan…')
      }
    }
    if (ev.type === 'result') { text = String(ev.result ?? ''); isError = !!ev.is_error }
  })
  proc.stderr.on('data', (d) => { stderr += d.toString() })
  proc.on('error', (err) => { stderr += `\n${err.message}` })
  proc.on('close', (code) => {
    clearTimeout(timer)
    try {
      if (isError) throw new Error(text.trim() || 'Claude reported an error')
      const start = text.indexOf('{'), end = text.lastIndexOf('}')
      if (start < 0 || end < start) throw new Error(text.trim().slice(0, 300) || stderr.trim().split('\n').slice(-3).join('\n') || `claude exited with code ${code}`)
      job.plan = cleanPlan(JSON.parse(text.slice(start, end + 1)))
      job.status = 'done'
    } catch (e) {
      job.status = 'error'
      job.error = (e as Error).message
    }
  })
  return getPlan(pid)!
}

// Create the scenes. "replace" moves the existing scenes to the trash once the new ones are in place.
export async function applyPlan(pid: string, scenes: PlanScene[], mode: 'append' | 'replace') {
  const plan = cleanPlan(scenes)
  const p = await loadProject(pid)
  const old = p.scenes.map(s => s.id)
  const created: string[] = []
  for (const s of plan) {
    const id = newSceneId(s.title)
    const html = blankScene(s.title, s.duration, { brief: s.brief, ...(s.voice && { voice: s.voice }) })
    await writeScene(pid, id, html)
    await addVersion(pid, id, html, 'Storyboard')
    p.scenes.push({ id, title: s.title })
    created.push(id)
  }
  await saveProject(p)
  if (mode === 'replace') for (const id of old) await trashScene(pid, id).catch(() => {})
  return { created, project: await projectView(pid) }
}
