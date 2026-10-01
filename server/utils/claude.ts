import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { addVersion, blankScene, getChat, getVersions, loadProject, projectDir, saveChat, saveProject, sceneBeats, sceneFile, sceneViews, writeScene, type Project } from './store'

export interface ChatJob {
  status: 'running' | 'done' | 'error'
  prompt: string
  startedAt: number
  activity: string[]
  proc?: ChildProcess
}

const jobs = new Map<string, ChatJob>()
const TIMEOUT_MS = 15 * 60 * 1000

export const jobKey = (pid: string, key: string) => `${pid}:${key}`

export function getJob(pid: string, key: string) {
  const j = jobs.get(jobKey(pid, key))
  if (!j) return null
  return { status: j.status, prompt: j.prompt, startedAt: j.startedAt, activity: j.activity.slice(-6) }
}

export function cancelJob(pid: string, key: string) {
  jobs.get(jobKey(pid, key))?.proc?.kill()
}

function fmt(ms: number) { return `${(ms / 1000).toFixed(2)}s` }

async function sceneContext(pid: string, sid: string) {
  const p = await loadProject(pid)
  const views = await sceneViews(p)
  const i = views.findIndex(s => s.id === sid)
  if (i < 0) throw createError({ statusCode: 404, message: 'Scene not found' })
  const s = views[i]!, prev = views[i - 1], next = views[i + 1]
  const b = sceneBeats(p, s.start, s.duration)
  const lines = [
    `You are editing scene ${i + 1} of ${views.length}: "${s.title}" - file \`${s.file}\`.`,
    `It is currently ${s.duration}ms long and starts at ${fmt(s.start)} in the full video.`,
    prev ? `Previous scene: \`${prev.file}\` ("${prev.title}"). Its last frame cuts into this scene's first frame.` : 'This is the first scene.',
    next ? `Next scene: \`${next.file}\` ("${next.title}"). This scene's last frame cuts into its first frame.` : 'This is the last scene.',
    b.bpm
      ? `Music: ${Math.round(b.bpm * 10) / 10} BPM. Scene-relative ms - beats: [${b.beats.join(', ')}]; downbeats: [${b.downbeats.join(', ')}]; phrase starts: [${b.phrases.join(', ')}]. These are also available as VE.beats / VE.downbeats / VE.phrases.`
      : 'No music track is loaded.',
    '',
    `Follow the scene contract in CLAUDE.md. Read \`${s.file}\` first. Only edit \`${s.file}\` unless the request clearly asks for changes to other scenes.`,
    'Reply with a short plain-prose summary of what you changed (no markdown headings, no code).'
  ]
  return lines.join('\n')
}

async function projectContext(pid: string) {
  const p = await loadProject(pid)
  const views = await sceneViews(p)
  return [
    `You are working on the whole project "${p.name}" (${views.length} scenes):`,
    ...views.map((s, i) => `${i + 1}. "${s.title}" - \`${s.file}\` - ${s.duration}ms, starts at ${fmt(s.start)}`),
    p.audio?.bpm ? `Music: ${Math.round(p.audio.bpm * 10) / 10} BPM. Scenes can read beat times via VE.beats / VE.downbeats / VE.phrases.` : 'No music track is loaded.',
    '',
    'Follow the scene contract in CLAUDE.md.',
    'To add, remove, rename or reorder scenes, edit the `scenes` array in `project.json` (keep it valid JSON; ids are lowercase-kebab-case) and create or delete the matching `scenes/<id>.html` files. Do not change other keys in project.json.',
    'Reply with a short plain-prose summary of what you changed (no markdown headings, no code).'
  ].join('\n')
}

async function snapshot(pid: string) {
  const p = await loadProject(pid)
  const out = new Map<string, string>()
  for (const s of p.scenes) {
    try { out.set(s.id, await fs.readFile(sceneFile(pid, s.id), 'utf8')) } catch {}
  }
  return { project: await fs.readFile(join(projectDir(pid), 'project.json'), 'utf8'), scenes: out }
}

// After Claude runs, make project.json sane again and record versions for every scene file that changed.
async function reconcile(pid: string, before: Awaited<ReturnType<typeof snapshot>>, label: string) {
  let p: Project
  try {
    p = await loadProject(pid)
    if (!Array.isArray(p.scenes)) throw new Error('bad scenes')
  } catch {
    await fs.writeFile(join(projectDir(pid), 'project.json'), before.project)
    p = await loadProject(pid)
  }
  const prev = JSON.parse(before.project) as Project
  p = { ...prev, scenes: p.scenes.filter(s => s && typeof s.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(s.id)).map(s => ({ id: s.id, title: String(s.title || s.id) })) }
  for (const s of p.scenes) {
    let html: string
    try { html = await fs.readFile(sceneFile(pid, s.id), 'utf8') } catch {
      html = blankScene(s.title)
      await writeScene(pid, s.id, html)
    }
    const old = before.scenes.get(s.id)
    if (old === html) continue
    const idx = await getVersions(pid, s.id)
    if (!idx.items.length && old) await addVersion(pid, s.id, old, 'Before')
    await addVersion(pid, s.id, html, label)
  }
  await saveProject(p)
}

export async function startChat(pid: string, key: string, message: string) {
  const k = jobKey(pid, key)
  if (jobs.get(k)?.status === 'running') throw createError({ statusCode: 409, message: 'Claude is already working on this' })

  const project = await loadProject(pid)
  await saveProject(project) // refresh CLAUDE.md with the latest art direction
  const context = key === 'project' ? await projectContext(pid) : await sceneContext(pid, key)
  const prompt = `${context}\n\nRequest:\n${message}`

  const chat = await getChat(pid, key)
  chat.messages.push({ role: 'user', text: message, at: new Date().toISOString() })
  await saveChat(pid, key, chat)

  const before = await snapshot(pid)
  const job: ChatJob = { status: 'running', prompt: message, startedAt: Date.now(), activity: ['Starting Claude…'] }
  jobs.set(k, job)

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Edit,Write,MultiEdit,Glob,Grep',
    '--disallowedTools', 'Bash,WebFetch,WebSearch'
  ]
  if (process.env.STORYBOARD_MODEL) args.push('--model', process.env.STORYBOARD_MODEL)
  if (chat.sessionId) args.push('--resume', chat.sessionId)

  const proc = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: projectDir(pid), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  job.proc = proc
  proc.stdin.end(prompt)

  let result: { text: string, sessionId?: string, durationMs?: number, cost?: number, isError?: boolean } | null = null
  let sessionId = chat.sessionId
  let stderr = ''
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS)

  createInterface({ input: proc.stdout }).on('line', (line) => {
    let ev: any
    try { ev = JSON.parse(line) } catch { return }
    if (ev.session_id) sessionId = ev.session_id
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') {
          const f = c.input?.file_path || c.input?.pattern || c.input?.path || ''
          const short = String(f).replace(projectDir(pid), '').replace(/^[\\/]/, '').replace(/\\/g, '/')
          const verb = ({ Read: 'Reading', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', Glob: 'Searching', Grep: 'Searching' } as Record<string, string>)[c.name] || c.name
          job.activity.push(`${verb} ${short}`.trim())
        } else if (c.type === 'text' && c.text?.trim()) {
          job.activity.push(c.text.trim().split('\n')[0].slice(0, 160))
        }
      }
    }
    if (ev.type === 'result') {
      result = { text: ev.result ?? '', sessionId: ev.session_id, durationMs: ev.duration_ms, cost: ev.total_cost_usd, isError: ev.is_error }
    }
  })
  proc.stderr.on('data', (d) => { stderr += d.toString() })

  proc.on('error', (err) => {
    stderr += `\n${err.message}`
  })

  proc.on('close', async (code) => {
    clearTimeout(timer)
    try {
      await reconcile(pid, before, message)
    } catch (e) {
      stderr += `\nReconcile failed: ${(e as Error).message}`
    }
    const c = await getChat(pid, key)
    const r = result as typeof result
    if (r && !r.isError) {
      c.sessionId = r.sessionId ?? sessionId ?? null
      c.messages.push({ role: 'assistant', text: r.text.trim(), at: new Date().toISOString(), durationMs: r.durationMs ?? Date.now() - job.startedAt, costUsd: r.cost })
      job.status = 'done'
    } else {
      c.sessionId = sessionId ?? c.sessionId
      const why = r?.text || stderr.trim().split('\n').slice(-4).join('\n') || `claude exited with code ${code}`
      c.messages.push({ role: 'error', text: why, at: new Date().toISOString(), durationMs: Date.now() - job.startedAt })
      job.status = 'error'
    }
    await saveChat(pid, key, c)
    job.proc = undefined
  })

  return getJob(pid, key)
}
