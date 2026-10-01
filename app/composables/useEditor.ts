export interface SceneView {
  id: string
  title: string
  file: string
  path: string
  duration: number
  start: number
  mtime: number
}

export interface AudioInfo {
  file: string
  name: string
  duration?: number
  bpm?: number
  startOffset: number
  beats: number[]
  downbeats: number[]
  phrases: number[]
  peaks?: number[]
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
  versions: Record<string, number>
}

export type PlayMode = 'scene' | 'video'

const projects = ref<{ id: string, name: string }[]>([])
const project = ref<ProjectView | null>(null)
const selectedId = ref<string | null>(null)
const mainTab = ref<'scenes' | 'render'>('scenes')
const mode = ref<PlayMode>('scene')
const playing = ref(false)
const time = ref(0)
let audioEl: HTMLAudioElement | null = null
let raf = 0
let lastTick = 0

const selected = computed(() => project.value?.scenes.find(s => s.id === selectedId.value) ?? project.value?.scenes[0] ?? null)
const selectedIndex = computed(() => project.value?.scenes.findIndex(s => s.id === selected.value?.id) ?? -1)

const timelineStart = computed(() => mode.value === 'scene' ? (selected.value?.start ?? 0) : 0)
const timelineDuration = computed(() => mode.value === 'scene' ? (selected.value?.duration ?? 0) : (project.value?.duration ?? 0))

// The scene on screen and its local time, for either playback mode.
const active = computed(() => {
  const p = project.value
  if (!p || !selected.value) return null
  if (mode.value === 'scene') return { scene: selected.value, t: Math.min(time.value, selected.value.duration) }
  const g = time.value
  const s = p.scenes.find(x => g >= x.start && g < x.start + x.duration) ?? p.scenes.at(-1)!
  return { scene: s, t: Math.min(g - s.start, s.duration) }
})

// Music marks in timeline coordinates (ms from the start of the current timeline).
const marks = computed(() => {
  const a = project.value?.audio
  if (!a?.beats.length) return null
  const from = timelineStart.value + (a.startOffset || 0)
  const to = from + timelineDuration.value
  const map = (l: number[]) => l.filter(t => t >= from && t <= to).map(t => t - from)
  return { beats: map(a.beats), downbeats: map(a.downbeats), phrases: map(a.phrases) }
})

function audioUrl() {
  const p = project.value
  return p?.audio ? `/api/projects/${p.id}/files/audio/${p.audio.file}` : null
}

function ensureAudio() {
  const url = audioUrl()
  if (!url) {
    audioEl?.pause()
    audioEl = null
    return null
  }
  if (!audioEl || !audioEl.src.endsWith(url)) {
    audioEl?.pause()
    audioEl = new Audio(url)
    audioEl.preload = 'auto'
  }
  return audioEl
}

function audioTimeFor(t: number) {
  return ((project.value?.audio?.startOffset || 0) + timelineStart.value + t) / 1000
}

function syncAudio() {
  const a = ensureAudio()
  if (!a) return
  a.currentTime = audioTimeFor(time.value)
  if (playing.value) a.play().catch(() => {})
}

function tick(now: number) {
  if (!playing.value) return
  const a = audioEl
  const dur = timelineDuration.value
  if (a && !a.paused && !a.ended) {
    time.value = a.currentTime * 1000 - (project.value?.audio?.startOffset || 0) - timelineStart.value
  } else {
    time.value += now - lastTick
  }
  lastTick = now
  if (time.value >= dur) {
    if (mode.value === 'scene') {
      time.value = 0
      syncAudio()
    } else {
      time.value = dur
      pause()
      return
    }
  }
  raf = requestAnimationFrame(tick)
}

function play() {
  if (playing.value) return
  if (time.value >= timelineDuration.value - 1) time.value = 0
  playing.value = true
  lastTick = performance.now()
  syncAudio()
  raf = requestAnimationFrame(tick)
}

function pause() {
  playing.value = false
  cancelAnimationFrame(raf)
  audioEl?.pause()
}

function toggle() {
  playing.value ? pause() : play()
}

function seek(t: number) {
  time.value = Math.max(0, Math.min(t, timelineDuration.value))
  if (audioEl) audioEl.currentTime = audioTimeFor(time.value)
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
  ensureAudio()
  try { localStorage.setItem('storyboard:project', id) } catch {}
}

async function refresh() {
  if (!project.value) return
  setProject(await $fetch<ProjectView>(`/api/projects/${project.value.id}`))
}

function setProject(p: ProjectView) {
  project.value = p
  if (!p.scenes.some(s => s.id === selectedId.value)) selectedId.value = p.scenes[0]?.id ?? null
  if (time.value > timelineDuration.value) time.value = 0
  ensureAudio()
}

export function frameUrl(pid: string, s: SceneView, t?: number) {
  return `/api/projects/${pid}/scenes/${s.id}/frame?v=${Math.round(s.mtime)}${t !== undefined ? `&t=${Math.round(t)}` : ''}`
}

export function fmtSeconds(ms: number, digits = 2) {
  return `${(Math.max(0, ms) / 1000).toFixed(digits)}s`
}

export function useEditor() {
  return {
    projects, project, selectedId, selected, selectedIndex, mainTab,
    mode, playing, time, active, marks, timelineDuration, timelineStart,
    play, pause, toggle, seek, setMode, select,
    loadProjects, openProject, refresh, setProject
  }
}
