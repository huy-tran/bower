import type { ProjectView } from './useEditor'

// Changing a scene by hand, without Claude: retyping text in the preview, scene settings (params), animation
// timings and the code editor. Every save goes through one endpoint and becomes a version labelled "By hand".

export type TimingStart = { kind: 'at', ms: number } | { kind: 'end', ms: number } | { kind: 'stagger', ms: number, step: number, index: string }
export interface Timing { offset: number, match: string, label: string, line: string, start: TimingStart, dur: number, ease: string | null }
export interface SceneSource {
  sceneId: string
  source: string
  hash: string
  texts: { i: number, tag: string, text: string }[]
  timings: Timing[]
  computed: number
}
// An element picked in the preview.
export interface Picked {
  sceneId: string
  selector: string
  tag: string
  text: string
  html: string
  // Its number in the scene's markup (data-ve-i), or null when the scene's script created it.
  index: number | null
  // Holds only text, so it can be retyped.
  plain: boolean
  // The text param it shows (data-ve-param on it or an ancestor).
  param: string | null
}

export type EditOp =
  | { op: 'text', i: number, before: string, text: string }
  | { op: 'codeText', before: string, text: string }
  | { op: 'params', values: Record<string, unknown> }
  | { op: 'timing', offset: number, match: string, start: TimingStart, dur: number, ease: string | null }
  | { op: 'source', html: string }
  | { op: 'duration', ms: number }

const sideTab = ref<'chat' | 'edit'>('chat')
const source = ref<SceneSource | null>(null)
const picked = ref<Picked | null>(null)
const saving = ref(false)
// Bumped to ask the panel to focus a setting (a double-click on text that a param drives).
const focusParam = ref<{ name: string, n: number } | null>(null)
// Unsaved setting values being previewed live, by scene.
const previewValues = ref<Record<string, unknown>>({})
// The preview iframe of each scene, registered by the editable ScenePlayer.
const frames = new Map<string, HTMLIFrameElement>()

async function loadSource(pid: string, sid: string) {
  const res = await $fetch<Omit<SceneSource, 'sceneId'>>(`/api/projects/${pid}/scenes/${sid}/source`)
  source.value = { sceneId: sid, ...res }
  return source.value
}

async function apply(pid: string, sid: string, edit: EditOp) {
  const ed = useEditor()
  const toast = useToast()
  saving.value = true
  try {
    const base = source.value?.sceneId === sid ? source.value.hash : undefined
    const res = await $fetch<{ project: ProjectView }>(`/api/projects/${pid}/scenes/${sid}/edit`, { method: 'POST', body: { ...edit, base } })
    ed.setProject(res.project)
    previewValues.value = {}
    await loadSource(pid, sid).catch(() => {})
    return true
  } catch (e: any) {
    toast.add({ title: 'Could not save that change', description: e?.data?.message || e?.message, color: 'error' })
    // The file may have moved on (Claude, another window): show it as it is now.
    if (e?.statusCode === 409 || e?.status === 409) {
      await ed.refresh()
      await loadSource(pid, sid).catch(() => {})
    }
    return false
  } finally {
    saving.value = false
  }
}

const frameOf = (sid: string) => frames.get(sid)

function registerFrame(sid: string, el: HTMLIFrameElement | null) {
  if (el) frames.set(sid, el)
  else frames.delete(sid)
}

// Shows unsaved setting values in the preview straight away (the scene re-renders with them).
function previewParams(sid: string, values: Record<string, unknown>) {
  previewValues.value = values
  frames.get(sid)?.contentWindow?.postMessage({ __ve: true, type: 'params', values: JSON.parse(JSON.stringify(values)) }, '*')
}

// Hands the picked element to the chat, so the next message is about it.
const queuedTarget = ref<Picked | null>(null)
function askClaude(p: Picked) {
  queuedTarget.value = p
  sideTab.value = 'chat'
}

export function useSceneEdit() {
  return { sideTab, source, picked, saving, focusParam, previewValues, loadSource, apply, registerFrame, frameOf, previewParams, queuedTarget, askClaude }
}
