import type { ProjectView } from './useEditor'
import type { Tracks } from '#shared/utils/tracks'

// Changing a scene by hand, without Claude: retyping text in the preview, scene settings (params), animation
// timings and the code editor. Changes collect in an unsaved draft of the scene, which the preview shows, until
// Save keeps them as one version labelled "By hand" or Discard drops them.

export type TimingStart = { kind: 'at', ms: number } | { kind: 'end', ms: number } | { kind: 'stagger', ms: number, step: number, index: string }
export interface Timing { offset: number, match: string, label: string, line: string, start: TimingStart, dur: number, ease: string | null }
export interface SceneSource {
  sceneId: string
  source: string
  hash: string
  texts: { i: number, tag: string, text: string }[]
  timings: Timing[]
  computed: number
  tracks: Tracks
  // Where each element of the markup starts in `source`, for "Show in code".
  elements: { i: number, start: number }[]
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
  // Its layer id (data-ve-id), which its keyframes are stored under, and its name in the layers list.
  veId: string | null
  name: string
  // Its style as it is now, for inspector fields that have no value of their own.
  styles: { color: string, background: string, fontSize: number, letterSpacing: number, radius: number }
}

export type EditOp =
  | { op: 'text', i: number, before: string, text: string }
  | { op: 'codeText', before: string, text: string }
  | { op: 'params', values: Record<string, unknown> }
  | { op: 'timing', offset: number, match: string, start: TimingStart, dur: number, ease: string | null }
  | { op: 'source', html: string }
  | { op: 'duration', ms: number }
  | { op: 'track', key?: string, index?: number | null, selector?: string, props: Record<string, unknown>, label?: string }
  | { op: 'name', index: number, name: string }

const sideTab = ref<'chat' | 'edit'>('chat')
const source = ref<SceneSource | null>(null)
const picked = ref<Picked | null>(null)
const saving = ref(false)
// Bumped to ask the panel to focus a setting (a double-click on text that a param drives).
const focusParam = ref<{ name: string, n: number } | null>(null)
// Unsaved setting values being previewed live, by scene.
const previewValues = ref<Record<string, unknown>>({})
// Keyframes being previewed (dragging in the preview, scrubbing a field) before they go into the draft.
const liveTracks = ref<Tracks | null>(null)
// Bumped whenever a preview frame loads, so lists read from its document (layers) refresh.
const frameLoads = ref(0)
// An element of the markup to show in the code editor ("Show in code"), by its number.
const showInCode = ref<{ index: number, n: number } | null>(null)
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
    liveTracks.value = null
    return true
  } catch (e: any) {
    toast.add({ title: 'Could not make that change', description: e?.data?.message || e?.message, color: 'error' })
    // Whatever was being previewed goes back to what is in the draft.
    previewTracks(sid, null)
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

// The scene's unsaved hand edits: save them as one version, discard them, or take back the latest one.
async function draft(pid: string, sid: string, action: 'save' | 'discard' | 'undo') {
  const ed = useEditor()
  const toast = useToast()
  saving.value = true
  try {
    ed.setProject(await $fetch<ProjectView>(`/api/projects/${pid}/scenes/${sid}/draft`, { method: 'POST', body: { action } }))
    previewValues.value = {}
    await loadSource(pid, sid).catch(() => {})
    liveTracks.value = null
    if (action === 'save') toast.add({ title: 'Changes saved', description: 'Saved as one new version. Claude sees them from your next message.', color: 'success' })
    return true
  } catch (e: any) {
    toast.add({ title: action === 'save' ? 'Could not save' : action === 'discard' ? 'Could not discard' : 'Nothing to undo', description: e?.data?.message || e?.message, color: action === 'undo' ? 'neutral' : 'error' })
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

// Shows keyframes in the preview straight away, before they are added to the draft (null: back to the draft's).
function previewTracks(sid: string, tracks: Tracks | null) {
  liveTracks.value = tracks
  frames.get(sid)?.contentWindow?.postMessage({ __ve: true, type: 'tracks', tracks: tracks && JSON.parse(JSON.stringify(tracks)) }, '*')
}

// Hands the picked element to the chat, so the next message is about it.
const queuedTarget = ref<Picked | null>(null)
function askClaude(p: Picked) {
  queuedTarget.value = p
  sideTab.value = 'chat'
}

export function useSceneEdit() {
  return { sideTab, source, picked, saving, focusParam, previewValues, liveTracks, frameLoads, showInCode, loadSource, apply, draft, registerFrame, frameOf, previewParams, previewTracks, queuedTarget, askClaude }
}
