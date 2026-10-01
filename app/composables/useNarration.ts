// Turns scene scripts (the "voice" key of a scene's meta block) into voice clips, automatically.
// Whenever a scene has a script with no up-to-date clip, the speech is generated (in a worker) and uploaded
// pinned to that scene. One scene at a time; a scene that fails is left alone until the script changes or Retry.
import type { SceneView } from './useEditor'

export type SceneStatus =
  | { state: 'queued' }
  | { state: 'generating', label: string, pct?: number }
  | { state: 'done', durationMs: number, overBy: number }
  | { state: 'failed', error: string }

const state = reactive({
  busy: null as string | null, // scene id being generated
  title: '',
  label: '',
  pct: undefined as number | undefined,
  // The current (or last finished) batch, in order: what each scene is up to.
  batch: [] as { id: string, title: string }[],
  status: new Map<string, SceneStatus>(),
  finishedAt: null as number | null,
  failed: new Map<string, string>() // scene id -> key that failed
})
let running = false
let started = false

const keyOf = (text: string, voice: string, speed: number) => JSON.stringify([text, voice, speed])

export function useNarration() {
  const ed = useEditor()
  const { project } = ed
  const toast = useToast()

  // What will be spoken: the script with the narrator's pronunciation fixes applied, in the project's voice.
  function settings(s: SceneView) {
    const n = project.value!.narrator
    const text = s.voice!.text
    return { text, spoken: applyPronunciations(text, n.pronunciations), voice: s.voice!.voice || n.voice, speed: s.voice!.speed || n.speed, pronunciations: n.pronunciations }
  }

  // Scenes whose script has no matching clip yet (a pronunciation change only affects scenes that use the term).
  const pending = computed(() => {
    const p = project.value
    if (!p) return []
    return p.scenes.filter((s) => {
      if (!s.voice) return false
      const { spoken, voice, speed } = settings(s)
      const key = keyOf(spoken, voice, speed)
      if (state.failed.get(s.id) === key) return false
      const clip = p.clips.find(c => c.sceneId === s.id)
      return !clip?.source || keyOf(clip.source.spoken ?? clip.source.text, clip.source.voice, clip.source.speed) !== key
    })
  })

  const counts = computed(() => {
    const c = { total: state.batch.length, done: 0, failed: 0, queued: 0 }
    for (const { id } of state.batch) {
      const st = state.status.get(id)?.state
      if (st === 'done') c.done++
      else if (st === 'failed') c.failed++
      else if (st === 'queued') c.queued++
    }
    return c
  })

  // Scenes with a script, with their narration state, for the status list and the scene strip.
  function statusOf(sceneId: string): SceneStatus | null {
    const live = state.status.get(sceneId)
    if (live) return live
    const p = project.value
    const s = p?.scenes.find(x => x.id === sceneId)
    if (!s?.voice) return null
    const clip = p!.clips.find(c => c.sceneId === sceneId)
    if (clip?.source) return { state: 'done', durationMs: clip.duration, overBy: Math.max(0, clip.duration - s.duration) }
    return state.failed.has(sceneId) ? { state: 'failed', error: 'Could not generate' } : { state: 'queued' }
  }

  async function generate(s: SceneView) {
    const pid = project.value!.id
    const { text, spoken, voice, speed, pronunciations } = settings(s)
    state.busy = s.id
    state.title = s.title
    state.label = 'Starting'
    state.pct = undefined
    state.status.set(s.id, { state: 'generating', label: 'Starting' })
    try {
      const { blob, durationMs, captions } = await speak(text, { voice, speed, pronunciations }, (label, pct) => { state.label = label; state.pct = pct; state.status.set(s.id, { state: 'generating', label, pct }) })
      if (project.value?.id !== pid) throw new Error('Project changed while narrating')
      state.label = 'Saving'
      state.status.set(s.id, { state: 'generating', label: 'Saving' })
      const form = new FormData()
      form.append('file', new File([blob], `${s.title.replace(/[^\w ]+/g, '').trim() || 'voice-over'}.wav`, { type: 'audio/wav' }))
      form.append('sceneId', s.id)
      form.append('duration', String(durationMs))
      form.append('source', JSON.stringify({ text, voice, speed, spoken }))
      form.append('captions', JSON.stringify(captions))
      const res = await $fetch<{ id: string, project: any }>(`/api/projects/${pid}/clips`, { method: 'POST', body: form })
      if (project.value?.id === pid) ed.setProject(res.project)
      state.status.set(s.id, { state: 'done', durationMs, overBy: Math.max(0, durationMs - s.duration) })
    } catch (err: any) {
      const message = err?.data?.message || err?.message || 'Could not generate'
      state.failed.set(s.id, keyOf(spoken, voice, speed))
      state.status.set(s.id, { state: 'failed', error: message })
    } finally {
      state.busy = null
    }
  }

  function summarise() {
    const c = counts.value
    if (!c.total) return
    const voiceMs = state.batch.reduce((a, { id }) => { const st = state.status.get(id); return a + (st?.state === 'done' ? st.durationMs : 0) }, 0)
    const long = state.batch.filter(({ id }) => { const st = state.status.get(id); return st?.state === 'done' && st.overBy > 50 })
    if (c.failed && !c.done) {
      toast.add({ title: `Narration failed for ${c.failed} scene${c.failed > 1 ? 's' : ''}`, description: 'Open the narration status in the header for details, or Retry in Settings, Sound.', color: 'error' })
      return
    }
    const parts = [`${c.done} scene${c.done > 1 ? 's' : ''} narrated, ${fmtSeconds(voiceMs, 0)} of voice-over.`]
    if (long.length) parts.push(`${long.length} run${long.length > 1 ? '' : 's'} longer than the scene: ${long.map(x => `“${x.title}”`).join(', ')}.`)
    if (c.failed) parts.push(`${c.failed} failed.`)
    toast.add({ title: c.failed || long.length ? 'Narration finished with notes' : 'Narration ready', description: parts.join(' '), color: c.failed || long.length ? 'warning' : 'success', duration: 8000 })
  }

  async function drain() {
    if (running) return
    running = true
    // A new batch starts from the current queue; anything that joins while running is appended.
    state.batch = pending.value.map(s => ({ id: s.id, title: s.title }))
    state.status = new Map(state.batch.map(b => [b.id, { state: 'queued' as const }]))
    state.finishedAt = null
    try {
      let next: SceneView | undefined
      while ((next = pending.value[0])) {
        if (!state.batch.some(b => b.id === next!.id)) { state.batch.push({ id: next.id, title: next.title }); state.status.set(next.id, { state: 'queued' }) }
        await generate(next)
      }
    } finally {
      running = false
      state.finishedAt = Date.now()
      summarise()
    }
  }

  // Regenerate one scene even if its clip is current (for example after changing the narrator voice elsewhere).
  async function regenerate(sceneId: string) {
    const s = project.value?.scenes.find(x => x.id === sceneId)
    if (!s?.voice || running) return
    state.failed.delete(sceneId)
    running = true
    state.batch = [{ id: s.id, title: s.title }]
    state.status = new Map([[s.id, { state: 'queued' as const }]])
    state.finishedAt = null
    try { await generate(s) } finally { running = false; state.finishedAt = Date.now(); summarise() }
    await drain()
  }

  function retry() {
    state.failed.clear()
    drain()
  }

  function dismiss() {
    if (running) return
    state.batch = []
    state.status = new Map()
    state.finishedAt = null
  }

  if (!started) {
    started = true
    watch(pending, (list) => { if (list.length) drain() }, { immediate: true })
  }

  return { state: readonly(state), pending, counts, statusOf, regenerate, retry, dismiss }
}
