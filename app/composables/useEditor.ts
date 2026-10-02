// Explicit import: these are auto-imported from shared/utils too, but the dev server's registry can go stale
// after many file changes and drop them, which breaks the whole editor at runtime.
import { captionAt, layersAt, musicGainAt, type Caption, type Layer, type Transition } from '#shared/utils/timeline'

export interface SceneView {
  id: string
  title: string
  file: string
  path: string
  duration: number
  start: number
  mtime: number
  transition: Transition | null
  voice: { text: string, voice?: string, speed?: number } | null
  brief: string
  app: 'shots' | 'rebuild' | 'auto' | null
}

export interface Section { start: number, end: number, label: string, energy: number }

export interface AudioInfo {
  file: string
  name: string
  duration?: number
  bpm?: number
  startOffset: number
  beats: number[]
  downbeats: number[]
  phrases: number[]
  sections?: Section[]
  peaks?: number[]
  gain?: number
  fadeIn?: number
  fadeOut?: number
  duck?: number
}

export interface Clip {
  id: string
  kind: 'sfx' | 'voice'
  file: string
  name: string
  start: number
  duration: number
  gain: number
  captions?: Caption[] | null
  sceneId?: string | null
  source?: { text: string, voice: string, speed: number, spoken?: string } | null
}

export interface ProjectView {
  id: string
  name: string
  artDirection: string
  width: number
  height: number
  fps: number
  path: string
  duration: number
  scenes: SceneView[]
  audio: AudioInfo | null
  clips: Clip[]
  captions: { burnIn: boolean, position: 'bottom' | 'top', size: number }
  brandKitId: string | null
  visualChecks: boolean
  // This project's own repositories; the shared app's come separately as appCodebases.
  codebases: { label: string, path: string, notes: string }[]
  // The shared app this project is about (Bower settings, Apps), with this project's way of showing it.
  app: { id: string, name: string, url: string, notes: string, mode: 'shots' | 'rebuild' | 'auto' } | null
  appCodebases: { label: string, path: string, notes: string }[]
  narrator: { voice: string, speed: number, shortlist: string[], pronunciations: { term: string, sayAs: string }[] }
  folder: string
  versions: Record<string, number>
}

export interface Seam { from: string, to: string, diff: number, url: string, transition: { type: string, duration: number } | null }

export type PlayMode = 'scene' | 'video'
export interface ScreenLayer extends Layer { scene: SceneView }

const projects = ref<{ id: string, name: string, folder: string, createdAt: string }[]>([])
const project = ref<ProjectView | null>(null)
const selectedId = ref<string | null>(null)
const mainTab = ref<'scenes' | 'render'>('scenes')
const mode = ref<PlayMode>('scene')
const playing = ref(false)
const time = ref(0)
const rate = ref(1)
// Loop region in timeline ms, or null for the whole timeline.
const loop = ref<{ from: number, to: number } | null>(null)
// Visible part of the timeline as fractions 0..1 (zoom).
const view = ref({ from: 0, to: 1 })

let musicEl: HTMLAudioElement | null = null
const clipEls = new Map<string, HTMLAudioElement>()
let raf = 0
let lastTick = 0

const selected = computed(() => project.value?.scenes.find(s => s.id === selectedId.value) ?? project.value?.scenes[0] ?? null)
const selectedIndex = computed(() => project.value?.scenes.findIndex(s => s.id === selected.value?.id) ?? -1)

const timelineStart = computed(() => mode.value === 'scene' ? (selected.value?.start ?? 0) : 0)
const timelineDuration = computed(() => mode.value === 'scene' ? (selected.value?.duration ?? 0) : (project.value?.duration ?? 0))
// Video time of the playhead.
const videoTime = computed(() => timelineStart.value + time.value)

// What is on screen. In scene mode only the selected scene; in video mode transitions can show two at once.
const layers = computed<ScreenLayer[]>(() => {
  const p = project.value
  const s = selected.value
  if (!p || !s) return []
  if (mode.value === 'scene') {
    return [{ index: selectedIndex.value, t: Math.min(time.value, s.duration), opacity: 1, transform: '', clip: '', filter: '', z: 1, scene: s }]
  }
  return layersAt(p.scenes, time.value).map(l => ({ ...l, scene: p.scenes[l.index]! }))
})

// The main scene on screen (the later one during a transition) and its local time.
const active = computed(() => {
  const p = project.value
  if (!p || !selected.value) return null
  if (mode.value === 'scene') return { scene: selected.value, t: Math.min(time.value, selected.value.duration) }
  const g = time.value
  const s = p.scenes.find(x => g >= x.start && g < x.start + x.duration) ?? p.scenes.at(-1)!
  return { scene: s, t: Math.min(g - s.start, s.duration) }
})

const caption = computed(() => {
  const p = project.value
  if (!p?.captions.burnIn) return ''
  return captionAt(p.clips, videoTime.value)
})

// Music marks in timeline coordinates (ms from the start of the current timeline).
const marks = computed(() => {
  const a = project.value?.audio
  if (!a?.beats.length) return null
  const from = timelineStart.value + (a.startOffset || 0)
  const to = from + timelineDuration.value
  const map = (l: number[]) => l.filter(t => t >= from && t <= to).map(t => t - from)
  const sections = (a.sections ?? [])
    .filter(s => s.end > from && s.start < to)
    .map(s => ({ ...s, start: Math.max(0, s.start - from), end: Math.min(to - from, s.end - from) }))
  return { beats: map(a.beats), downbeats: map(a.downbeats), phrases: map(a.phrases), sections }
})

// Sound clips in timeline coordinates.
const clipMarks = computed(() => {
  const p = project.value
  if (!p) return []
  const from = timelineStart.value, to = from + timelineDuration.value
  return p.clips
    .filter(c => c.start < to && c.start + (c.duration || 0) > from)
    .map(c => ({ id: c.id, kind: c.kind, name: c.name, start: c.start - from, end: Math.min(to, c.start + (c.duration || 0)) - from }))
})

const fileUrl = (file: string) => `/api/projects/${project.value!.id}/files/audio/${file}`

function ensureAudio() {
  const p = project.value
  const url = p?.audio ? fileUrl(p.audio.file) : null
  if (!url) {
    musicEl?.pause()
    musicEl = null
  } else if (!musicEl || !musicEl.src.endsWith(url)) {
    musicEl?.pause()
    musicEl = new Audio(url)
    musicEl.preload = 'auto'
  }
  const ids = new Set(p?.clips.map(c => c.id) ?? [])
  for (const [id, el] of clipEls) if (!ids.has(id)) { el.pause(); clipEls.delete(id) }
  for (const c of p?.clips ?? []) {
    if (!clipEls.has(c.id)) {
      const el = new Audio(fileUrl(c.file))
      el.preload = 'auto'
      clipEls.set(c.id, el)
    }
  }
  for (const el of [musicEl, ...clipEls.values()]) {
    if (!el) continue
    el.playbackRate = rate.value
    ;(el as any).preservesPitch = true
  }
}

function musicTimeFor(t: number) {
  return ((project.value?.audio?.startOffset || 0) + timelineStart.value + t) / 1000
}

// Keep every audio element where the playhead says it should be, at the right level.
function syncSound(hard = false) {
  const p = project.value
  if (!p) return
  const g = videoTime.value
  if (musicEl && p.audio) {
    musicEl.volume = Math.min(1, Math.max(0, musicGainAt(p.audio, p.clips, p.duration, g)))
    const want = musicTimeFor(time.value)
    if (hard || Math.abs(musicEl.currentTime - want) > 0.15) musicEl.currentTime = want
    if (playing.value && musicEl.paused) musicEl.play().catch(() => {})
  }
  for (const c of p.clips) {
    const el = clipEls.get(c.id)
    if (!el) continue
    const inside = g >= c.start && g < c.start + (c.duration || 1e9)
    if (playing.value && inside) {
      const want = (g - c.start) / 1000
      if (el.paused || Math.abs(el.currentTime - want) > 0.15) el.currentTime = want
      el.volume = Math.min(1, c.gain)
      if (el.paused) el.play().catch(() => {})
    } else if (!el.paused) {
      el.pause()
    }
  }
}

function stopSound() {
  musicEl?.pause()
  for (const el of clipEls.values()) el.pause()
}

function bounds() {
  const l = loop.value
  return l ? { from: l.from, to: l.to } : { from: 0, to: timelineDuration.value }
}

function tick(now: number) {
  if (!playing.value) return
  const m = musicEl
  if (m && !m.paused && !m.ended) {
    time.value = m.currentTime * 1000 - (project.value?.audio?.startOffset || 0) - timelineStart.value
  } else {
    time.value += (now - lastTick) * rate.value
  }
  lastTick = now
  const b = bounds()
  if (time.value >= b.to) {
    if (mode.value === 'scene' || loop.value) {
      time.value = b.from
      syncSound(true)
    } else {
      time.value = b.to
      pause()
      return
    }
  }
  syncSound()
  raf = requestAnimationFrame(tick)
}

function play() {
  if (playing.value) return
  const b = bounds()
  if (time.value >= b.to - 1 || time.value < b.from) time.value = b.from
  playing.value = true
  lastTick = performance.now()
  ensureAudio()
  syncSound(true)
  raf = requestAnimationFrame(tick)
}

function pause() {
  playing.value = false
  cancelAnimationFrame(raf)
  stopSound()
}

function toggle() {
  playing.value ? pause() : play()
}

function seek(t: number) {
  time.value = Math.max(0, Math.min(t, timelineDuration.value))
  if (playing.value) syncSound(true)
}

function setRate(r: number) {
  rate.value = r
  for (const el of [musicEl, ...clipEls.values()]) if (el) el.playbackRate = r
}

function setLoop(from: number | null, to?: number) {
  if (from === null || to === undefined || Math.abs(to - from) < 50) {
    loop.value = null
    return
  }
  loop.value = { from: Math.max(0, Math.min(from, to)), to: Math.min(timelineDuration.value, Math.max(from, to)) }
}

function setView(from: number, to: number) {
  const span = Math.max(0.02, Math.min(1, to - from))
  const f = Math.max(0, Math.min(1 - span, from))
  view.value = { from: f, to: f + span }
}

function setMode(m: PlayMode) {
  if (m === mode.value) return
  const wasPlaying = playing.value
  pause()
  // Keep the same frame on screen when switching.
  if (m === 'video') time.value = (selected.value?.start ?? 0) + time.value
  else if (active.value) {
    selectedId.value = active.value.scene.id
    time.value = active.value.t
  }
  mode.value = m
  loop.value = null
  view.value = { from: 0, to: 1 }
  if (wasPlaying) play()
}

function select(id: string) {
  if (mode.value === 'video') {
    const s = project.value?.scenes.find(x => x.id === id)
    selectedId.value = id
    if (s) seek(s.start)
    return
  }
  if (selectedId.value !== id) {
    selectedId.value = id
    loop.value = null
    view.value = { from: 0, to: 1 }
    seek(0)
  }
}

async function loadProjects() {
  projects.value = await $fetch('/api/projects')
}

async function openProject(id: string) {
  pause()
  project.value = await $fetch<ProjectView>(`/api/projects/${id}`)
  selectedId.value = project.value.scenes[0]?.id ?? null
  time.value = 0
  mode.value = 'scene'
  loop.value = null
  view.value = { from: 0, to: 1 }
  ensureAudio()
  try { localStorage.setItem('bower:project', id) } catch {}
  rememberRecent(id)
}

// Recently opened projects, newest first, for the Bower menu (this browser only).
const recentIds = ref<string[]>([])
try { recentIds.value = JSON.parse(localStorage.getItem('bower:recent') || '[]') } catch {}
function rememberRecent(id: string) {
  recentIds.value = [id, ...recentIds.value.filter(x => x !== id)].slice(0, 8)
  try { localStorage.setItem('bower:recent', JSON.stringify(recentIds.value)) } catch {}
}

async function refresh() {
  if (!project.value) return
  setProject(await $fetch<ProjectView>(`/api/projects/${project.value.id}`))
}

function setProject(p: ProjectView) {
  project.value = p
  if (!p.scenes.some(s => s.id === selectedId.value)) selectedId.value = p.scenes[0]?.id ?? null
  if (time.value > timelineDuration.value) time.value = 0
  if (loop.value && loop.value.to > timelineDuration.value) loop.value = null
  ensureAudio()
}

function closeProject() {
  pause()
  project.value = null
  selectedId.value = null
}

export function frameUrl(pid: string, s: SceneView, t?: number, version?: number) {
  return `/api/projects/${pid}/scenes/${s.id}/frame?v=${Math.round(s.mtime)}${t !== undefined ? `&t=${Math.round(t)}` : ''}${version ? `&version=${version}` : ''}`
}

export function fmtSeconds(ms: number, digits = 2) {
  return `${(Math.max(0, ms) / 1000).toFixed(digits)}s`
}

export function useEditor() {
  return {
    projects, project, selectedId, selected, selectedIndex, mainTab,
    mode, playing, time, rate, loop, view, layers, active, caption, marks, clipMarks,
    timelineDuration, timelineStart, videoTime,
    play, pause, toggle, seek, setRate, setLoop, setView, setMode, select,
    loadProjects, openProject, refresh, setProject, closeProject, recentIds: readonly(recentIds)
  }
}
