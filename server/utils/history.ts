import { getVersions, loadProject, projectView, restoreVersion } from './store'
import { listTrashedScenes, restoreScene, trashScene } from './trash'

// A project-wide timeline built from every scene's versions and the scene trash, and "rewind" to a moment in it.
// Scene order and transitions are not versioned, so they are left as they are.
export interface HistoryEntry {
  sceneId: string
  title: string
  at: string
  label: string
  kind: 'created' | 'version' | 'deleted'
  n: number
  current: boolean
  trashId?: string
}

export async function projectHistory(pid: string): Promise<HistoryEntry[]> {
  const p = await loadProject(pid)
  const out: HistoryEntry[] = []
  for (const s of p.scenes) {
    const idx = await getVersions(pid, s.id)
    for (const v of idx.items) out.push({ sceneId: s.id, title: s.title, at: v.at, label: v.label, kind: v.n === idx.items[0]?.n ? 'created' : 'version', n: v.n, current: idx.current === v.n })
  }
  for (const t of await listTrashedScenes(pid)) out.push({ sceneId: t.sceneId, title: t.title, at: t.deletedAt, label: 'Deleted', kind: 'deleted', n: 0, current: false, trashId: t.id })
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

// Put every scene back the way it was at `at`: the latest version made at or before that moment. Scenes that did
// not exist yet go to the trash; scenes deleted after that moment come back.
export async function rewindProject(pid: string, at: string) {
  const p = await loadProject(pid)
  const changed: { sceneId: string, title: string, action: string }[] = []
  const trashedNow = new Set<string>()
  for (const s of [...p.scenes]) {
    const idx = await getVersions(pid, s.id)
    const target = [...idx.items].filter(v => v.at <= at).at(-1)
    if (!target) {
      try { await trashScene(pid, s.id); trashedNow.add(s.id); changed.push({ sceneId: s.id, title: s.title, action: 'removed (it did not exist yet)' }) } catch {}
      continue
    }
    if (target.n !== idx.current) {
      await restoreVersion(pid, s.id, target.n)
      changed.push({ sceneId: s.id, title: s.title, action: `back to "${target.label}"` })
    }
  }
  for (const t of await listTrashedScenes(pid)) {
    if (t.deletedAt <= at || trashedNow.has(t.sceneId)) continue
    try { await restoreScene(pid, t.id); changed.push({ sceneId: t.sceneId, title: t.title, action: 'restored from the trash' }) } catch {}
  }
  return { changed, project: await projectView(pid) }
}
