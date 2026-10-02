import type { ChildProcess } from 'node:child_process'
import { requireClaude, spawnClaude } from './claudeBin'
import { readSettings } from './settings'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { addVersion, allCodebases, blankScene, getChat, getVersions, loadProject, projectDir, saveChat, saveProject, sceneBeats, sceneFile, sceneViews, writeScene, type AppMode, type Project, type SceneView } from './store'

export interface ChatJob {
  status: 'running' | 'done' | 'error'
  prompt: string
  startedAt: number
  activity: string[]
  // Text of the reply being written right now (streamed), reset at each new assistant turn.
  partial: string
  proc?: ChildProcess
}

export interface ChatOptions {
  origin?: string
  model?: string
  attachments?: string[]
  at?: number
}

const jobs = new Map<string, ChatJob>()
const TIMEOUT_MS = 15 * 60 * 1000
const MODELS = ['opus', 'sonnet', 'haiku']

export const jobKey = (pid: string, key: string) => `${pid}:${key}`

export function getJob(pid: string, key: string) {
  const j = jobs.get(jobKey(pid, key))
  if (!j) return null
  return { status: j.status, prompt: j.prompt, startedAt: j.startedAt, activity: j.activity.slice(-6), partial: j.partial }
}

export function cancelJob(pid: string, key: string) {
  jobs.get(jobKey(pid, key))?.proc?.kill()
}

function fmt(ms: number) { return `${(ms / 1000).toFixed(2)}s` }

function voiceLine(p: Project, s: { id: string, voice: { text: string } | null }) {
  if (!s.voice) return 'No voice-over on this scene. To narrate it, add a "voice" key with the script to the meta block (see "Voice-over" in CLAUDE.md).'
  const clip = p.clips.find(c => c.sceneId === s.id)
  const state = clip?.source?.text === s.voice.text
    ? `Its audio is ${fmt(clip!.duration)} long and starts with the scene; land key words close to when they are spoken (about 2.5 words per second).`
    : 'The editor generates the audio after you finish.'
  return `Voice-over script (the "voice" key in the meta block): "${s.voice.text}". ${state}`
}

// How to show the app: the scene's own setting, else the project's. Spelled out every time, because users
// rarely say it in the request.
const APP_MODE_LINES: Record<AppMode, string> = {
  shots: 'Show the real app, not a rebuilt one: place screenshots in the scene with <img> and animate them with crops, zooms, pans and crossfades. Capture every state you need (several per run, with steps) rather than redrawing any part of the UI in HTML. Only rebuild an element when a screenshot cannot do it, and say so.',
  rebuild: 'Rebuild the app\'s screens in HTML/SVG inside the scene so their parts can animate separately. Use screenshots and the linked code as references for layout, colours, copy and iconography, but do not place screenshots in the scene.',
  auto: 'Choose: real screenshots placed in the scene are more authentic, rebuilt screens are better when parts must animate separately.'
}
const appLine = (p: Project, s?: SceneView) => p.app
  ? `The product is running at ${p.app.url}. Take screenshots of its real screens with \`node bower.mjs shot <page path> [desktop|laptop|tablet|mobile] [full] [steps]\` (see "The running product" in CLAUDE.md) and Read them. Steps (a JSON array of click, type, select, wait, scroll, hover, shot...) drive the page first, so you can capture real modals, menus and filled forms. To show the app in motion, \`node bower.mjs record <page> <steps>\` records the flow as a video clip (see "Video clips of real flows" in CLAUDE.md). ${APP_MODE_LINES[s?.app ?? p.app.mode ?? 'auto']}${s?.app ? ' (This scene sets this in the "app" key of its meta block; keep the key.)' : ''} An explicit instruction in the request overrides this.`
  : ''

const codebaseLine = (p: Project) => allCodebases(p).length
  ? `The product's source code is linked, read-only (see "Linked codebases" in CLAUDE.md): ${allCodebases(p).map(c => `${c.label} at \`${c.path}\``).join('; ')}. When the request refers to the app, its screens, components, copy, data or styling, look there first and reproduce what you find.`
  : ''

async function sceneContext(p: Project, sid: string, opts: ChatOptions) {
  const views = await sceneViews(p)
  const i = views.findIndex(s => s.id === sid)
  if (i < 0) throw createError({ statusCode: 404, message: 'Scene not found' })
  const s = views[i]!, prev = views[i - 1], next = views[i + 1]
  const b = sceneBeats(p, s.start, s.duration)
  const cut = (v: typeof s) => v.transition ? `a ${v.transition.duration}ms ${v.transition.type} transition` : 'a hard cut'
  const lines = [
    `You are editing scene ${i + 1} of ${views.length}: "${s.title}" (id \`${s.id}\`) - file \`${s.file}\`.`,
    `It is currently ${s.duration}ms long and starts at ${fmt(s.start)} in the full video.`,
    prev ? `Previous scene: \`${prev.file}\` ("${prev.title}"), joined to this one by ${cut(s)}.` : 'This is the first scene.',
    next ? `Next scene: \`${next.file}\` ("${next.title}"), joined by ${cut(next)}.` : 'This is the last scene.',
    b.bpm
      ? `Music: ${Math.round(b.bpm * 10) / 10} BPM. Scene-relative ms - beats: [${b.beats.join(', ')}]; downbeats: [${b.downbeats.join(', ')}]; phrase starts: [${b.phrases.join(', ')}]. These are also available as VE.beats / VE.downbeats / VE.phrases.`
      : 'No music track is loaded.',
    b.sections.length ? `Music sections in this scene: ${b.sections.map(x => `${x.label} ${x.start}-${x.end}ms`).join(', ')} (VE.sections).` : '',
    voiceLine(p, s),
    s.brief ? `Storyboard brief for this scene (the "brief" key in the meta block): "${s.brief}". Keep the key; update it only if the user changes what the scene is about.` : '',
    appLine(p, s),
    opts.at !== undefined ? `The user's playhead is at ${Math.round(opts.at)}ms in this scene; "here" or "this moment" means that time.` : '',
    codebaseLine(p),
    '',
    `Follow the scene contract in CLAUDE.md. Read \`${s.file}\` first. Only edit \`${s.file}\` unless the request clearly asks for changes to other scenes.`,
    p.visualChecks ? `When you have made a visual change, check it with \`node bower.mjs snap ${s.id} <ms...>\` and Read the PNGs before replying.` : '',
    'Reply with a short plain-prose summary of what you changed (no markdown headings, no code).'
  ]
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

async function projectContext(p: Project) {
  const views = await sceneViews(p)
  return [
    `You are working on the whole project "${p.name}" (${views.length} scenes, ${p.width}x${p.height} stage):`,
    ...views.map((s, i) => `${i + 1}. "${s.title}" (id \`${s.id}\`) - \`${s.file}\` - ${s.duration}ms, starts at ${fmt(s.start)}${s.transition ? `, ${s.transition.type} transition in` : ''}${s.brief ? ` - brief: "${s.brief.length > 120 ? s.brief.slice(0, 120) + '…' : s.brief}"` : ''}${s.voice ? ` - voice-over: "${s.voice.text.length > 90 ? s.voice.text.slice(0, 90) + '…' : s.voice.text}"` : ''}`),
    p.audio?.bpm ? `Music: ${Math.round(p.audio.bpm * 10) / 10} BPM. Scenes can read beat times via VE.beats / VE.downbeats / VE.phrases and sections via VE.sections.` : 'No music track is loaded.',
    'Voice-over: each scene\'s script is the "voice" key of its meta block; the editor generates the speech (see "Voice-over" in CLAUDE.md).',
    codebaseLine(p),
    appLine(p),
    '',
    'Follow the scene contract in CLAUDE.md.',
    'To add, remove, rename or reorder scenes, edit the `scenes` array in `project.json` (keep it valid JSON; ids are lowercase-kebab-case) and create or delete the matching `scenes/<id>.html` files. Do not change other keys in project.json.',
    p.visualChecks ? 'Check visual changes with `node bower.mjs snap <sceneId> <ms...>` (and `node bower.mjs seam` for cuts) before replying.' : '',
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
// Only the scene list (order, titles, new scenes) may change; transitions and everything else are kept.
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
  const prevScenes = new Map(prev.scenes.map(s => [s.id, s]))
  p = {
    ...prev,
    scenes: p.scenes
      .filter(s => s && typeof s.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(s.id))
      .map(s => ({ id: s.id, title: String(s.title || s.id), transition: prevScenes.get(s.id)?.transition ?? null }))
  }
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

function describeTool(p: Project, c: any) {
  if (c.name === 'Bash') {
    const cmd = String(c.input?.command || '')
    if (/bower\.mjs\s+snap/.test(cmd)) return 'Looking at frames'
    if (/bower\.mjs\s+seam/.test(cmd)) return 'Checking the cuts'
    if (/bower\.mjs\s+shot/.test(cmd)) return `Screenshotting ${cmd.replace(/.*bower\.mjs\s+shot\s*/, '').slice(0, 50)}`
    if (/bower\.mjs\s+record/.test(cmd)) return `Recording ${cmd.replace(/.*bower\.mjs\s+record\s*/, '').slice(0, 50)}`
    return `Running ${cmd.slice(0, 60)}`
  }
  const f = c.input?.file_path || c.input?.pattern || c.input?.path || ''
  let short = String(f).replace(projectDir(p.id), '')
  for (const c of allCodebases(p)) if (short.startsWith(c.path)) { short = c.label + short.slice(c.path.length); break }
  short = short.replace(/^[\\/]/, '').replace(/\\/g, '/')
  if (c.name === 'Read' && /\.(png|jpe?g|webp|gif)$/i.test(short)) return `Viewing ${short}`
  const verb = ({ Read: 'Reading', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', Glob: 'Searching', Grep: 'Searching' } as Record<string, string>)[c.name] || c.name
  return `${verb} ${short}`.trim()
}

export async function startChat(pid: string, key: string, message: string, opts: ChatOptions = {}) {
  const k = jobKey(pid, key)
  if (jobs.get(k)?.status === 'running') throw createError({ statusCode: 409, message: 'Claude is already working on this' })
  const bin = await requireClaude()

  const project = await loadProject(pid)
  await saveProject(project) // refresh CLAUDE.md and bower.mjs with the latest settings
  const attachments = (opts.attachments ?? []).filter(a => /^assets\/(shots\/)?[\w.-]+$/.test(a)).slice(0, 8)
  // The model picked for this message, else the default in Bower settings, else Claude Code's own.
  const model = opts.model && MODELS.includes(opts.model) ? opts.model : (await readSettings()).model ?? process.env.BOWER_MODEL
  const context = key === 'project' ? await projectContext(project) : await sceneContext(project, key, opts)
  const prompt = [
    context,
    '',
    attachments.length ? `Reference images attached by the user (Read each one first):\n${attachments.map(a => `- ${a}`).join('\n')}\n` : '',
    `Request:\n${message}`
  ].join('\n')

  const chat = await getChat(pid, key)
  chat.messages.push({ role: 'user', text: message, at: new Date().toISOString(), ...(attachments.length && { attachments }), ...(model && { model }) })
  await saveChat(pid, key, chat)

  const before = await snapshot(pid)
  const job: ChatJob = { status: 'running', prompt: message, startedAt: Date.now(), activity: ['Starting Claude…'], partial: '' }
  jobs.set(k, job)

  const tools = ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep']
  // The helper needs the editor's URL to render frames or take app screenshots.
  const visual = (project.visualChecks || !!project.app) && !!opts.origin
  if (visual) tools.push('Bash(node bower.mjs:*)')
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', tools.join(','),
    '--disallowedTools', visual ? 'WebFetch,WebSearch' : 'Bash,WebFetch,WebSearch'
  ]
  if (model) args.push('--model', model)
  if (chat.sessionId) args.push('--resume', chat.sessionId)
  // Read/Glob/Grep are refused outside the working directory in -p mode; --add-dir is the supported way to widen it.
  for (const c of allCodebases(project)) args.push('--add-dir', c.path)

  const proc = spawnClaude(bin, args, {
    cwd: projectDir(pid),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, BOWER_URL: opts.origin ?? '', BOWER_PROJECT: pid }
  })
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
    if (ev.type === 'stream_event') {
      const e = ev.event
      if (e?.type === 'message_start') job.partial = ''
      else if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') job.partial += e.delta.text
      return
    }
    if (ev.type === 'assistant') {
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') job.activity.push(describeTool(project, c))
        else if (c.type === 'text' && c.text?.trim()) job.activity.push(c.text.trim().split('\n')[0].slice(0, 160))
      }
    }
    if (ev.type === 'result') {
      result = { text: ev.result ?? '', sessionId: ev.session_id, durationMs: ev.duration_ms, cost: ev.total_cost_usd, isError: ev.is_error }
    }
  })
  proc.stderr.on('data', (d) => { stderr += d.toString() })
  proc.on('error', (err) => { stderr += `\n${err.message}` })

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
    job.partial = ''
    await saveChat(pid, key, c)
    job.proc = undefined
  })

  return getJob(pid, key)
}
