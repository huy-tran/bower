import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { addVersion, assertId, getVersions, projectDir, readScene, sceneMeta, writeScene } from './store'
import { sourceHash } from './sceneSource'

// Hand edits collect in a draft of the scene until the user saves them (one version for all of them) or discards
// them. The editor's preview shows the draft; renders, thumbnails, the player and Claude only ever see the saved
// file. `base` is the hash of the saved file the draft started from, so a save over a file that changed meanwhile
// (Claude, Undo in another window) is refused. `steps` are the states before each edit, for undo inside the draft.
export interface Draft {
  base: string
  html: string
  labels: string[]
  steps: { html: string, label: string }[]
  at: string
}

const MAX_STEPS = 50
const draftFile = (pid: string, sid: string) => join(projectDir(pid), '.bower', 'drafts', `${assertId(sid)}.json`)

export async function getDraft(pid: string, sid: string): Promise<Draft | null> {
  try { return JSON.parse(await fs.readFile(draftFile(pid, sid), 'utf8')) } catch { return null }
}

async function writeDraft(pid: string, sid: string, d: Draft) {
  await fs.mkdir(join(projectDir(pid), '.bower', 'drafts'), { recursive: true })
  await fs.writeFile(draftFile(pid, sid), JSON.stringify(d))
}

export async function removeDraft(pid: string, sid: string) {
  await fs.rm(draftFile(pid, sid), { force: true })
}

// What the editor works on: the draft when there is one, else the saved scene.
export async function editableSource(pid: string, sid: string) {
  return (await getDraft(pid, sid))?.html ?? await readScene(pid, sid)
}

// Adds one edit to the draft, starting one from the saved file if there is none.
export async function addToDraft(pid: string, sid: string, before: string, html: string, label: string) {
  const d = await getDraft(pid, sid) ?? { base: sourceHash(await readScene(pid, sid)), html: before, labels: [], steps: [], at: '' }
  d.steps = [...d.steps, { html: d.html, label }].slice(-MAX_STEPS)
  d.html = html
  d.labels = [...d.labels, label]
  d.at = new Date().toISOString()
  // Back where it started: nothing is left to save.
  if (sourceHash(html) === d.base) return removeDraft(pid, sid)
  await writeDraft(pid, sid, d)
}

// Takes back the latest edit in the draft.
export async function undoDraft(pid: string, sid: string) {
  const d = await getDraft(pid, sid)
  const last = d?.steps.at(-1)
  if (!d || !last) throw createError({ statusCode: 422, message: 'Nothing to undo' })
  d.steps = d.steps.slice(0, -1)
  d.labels = d.labels.slice(0, -1)
  d.html = last.html
  d.at = new Date().toISOString()
  if (!d.steps.length || sourceHash(d.html) === d.base) return removeDraft(pid, sid)
  await writeDraft(pid, sid, d)
}

// Writes the draft to the scene file as one version labelled with every change in it.
export async function saveDraft(pid: string, sid: string) {
  const d = await getDraft(pid, sid)
  if (!d) throw createError({ statusCode: 422, message: 'No unsaved changes' })
  const saved = await readScene(pid, sid)
  if (sourceHash(saved) !== d.base) throw createError({ statusCode: 409, message: 'This scene changed after you started editing it (Claude, or Undo). Discard your unsaved changes and make them again.' })
  const idx = await getVersions(pid, sid)
  if (!idx.items.length) await addVersion(pid, sid, saved, 'Before')
  await writeScene(pid, sid, d.html)
  // Repeated edits of one thing ("timing of fade" three times) are listed once.
  const labels = [...new Set(d.labels.map(l => l.replace(/^By hand:\s*/, '')))]
  await addVersion(pid, sid, d.html, `By hand: ${labels.join('; ')}`)
  await removeDraft(pid, sid)
}

// What the editor needs to know about each scene's draft.
export async function draftViews(pid: string, sceneIds: string[]) {
  const out: Record<string, { count: number, labels: string[], duration: number, params: ReturnType<typeof sceneMeta>['params'], mtime: number }> = {}
  for (const sid of sceneIds) {
    const d = await getDraft(pid, sid)
    if (!d) continue
    const m = sceneMeta(d.html)
    out[sid] = { count: d.labels.length, labels: d.labels.slice(-20), duration: m.duration, params: m.params, mtime: new Date(d.at).getTime() }
  }
  return out
}
