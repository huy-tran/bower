// Builds storyboard scenes one after another through the per-scene chat, so each gets Claude's full attention
// and the scene strip shows which one is being worked on. In step mode the build pauses after every scene and
// waits for the user to continue, redo the scene or stop.
export type BuildMode = 'all' | 'step'
type Decision = 'continue' | 'continueAll' | 'redo' | 'stop'

const state = reactive({
  building: false,
  mode: 'all' as BuildMode,
  pid: '',
  // The model picked for this build; undefined uses the project's model for building.
  model: undefined as string | undefined,
  queue: [] as string[],
  done: 0,
  total: 0,
  current: '' as string,
  currentId: '' as string,
  // Step mode, between scenes: the scene just built, awaiting a decision.
  waiting: false,
  stopRequested: false
})
let decide: ((d: Decision) => void) | null = null

export const BUILD_PROMPT = 'Build this scene from its storyboard brief (the "brief" key in the meta block). Replace the placeholder with the real scene: layout, typography, imagery and motion that fully deliver the brief, keeping the duration and timing anything spoken to the narration if there is one. Use the brand kit, linked codebases and the running product where they apply.'
const REDO_PROMPT = 'Build this scene again from its storyboard brief, taking a different approach to layout and motion than last time. Keep the duration and the narration.'

export function useStoryboard() {
  const ed = useEditor()
  const chat = useChat()
  const toast = useToast()

  async function buildOne(pid: string, id: string, prompt: string) {
    const title = state.current
    try {
      await chat.send(pid, id, prompt, { task: 'build', model: state.model })
      while (chat.isBusy(pid, id)) await new Promise(r => setTimeout(r, 1000))
    } catch (err: any) {
      toast.add({ title: `Could not build “${title}”`, description: err?.data?.message || err?.message, color: 'error' })
    }
  }

  async function buildAll(pid: string, sceneIds: string[], mode: BuildMode = 'all', model?: string) {
    if (state.building) return
    Object.assign(state, { building: true, mode, pid, model, queue: [...sceneIds], done: 0, total: sceneIds.length, current: '', currentId: '', waiting: false, stopRequested: false })
    try {
      while (state.queue.length && !state.stopRequested) {
        const id = state.queue.shift()!
        const scene = ed.project.value?.scenes.find(s => s.id === id)
        if (!scene || ed.project.value?.id !== pid) continue
        state.current = scene.title
        state.currentId = id
        await buildOne(pid, id, BUILD_PROMPT)
        state.done++
        // Ask before the next scene (and after the last one, so the user can still redo it).
        while (state.mode === 'step' && !state.stopRequested) {
          state.waiting = true
          const d = await new Promise<Decision>((resolve) => { decide = resolve })
          state.waiting = false
          decide = null
          if (d === 'redo') { await buildOne(pid, id, REDO_PROMPT); continue }
          if (d === 'continueAll') state.mode = 'all'
          if (d === 'stop') state.stopRequested = true
          break
        }
      }
      if (!state.stopRequested) toast.add({ title: 'Storyboard built', description: `${state.done} scene${state.done === 1 ? '' : 's'} done. Review each one and ask for changes in its chat.`, color: 'success', duration: 8000 })
    } finally {
      Object.assign(state, { building: false, waiting: false, current: '', currentId: '' })
      decide = null
    }
  }

  // Finish the scene being built, then stop.
  function stop() {
    state.stopRequested = true
    state.queue = []
    decide?.('stop')
  }

  // Cancel Claude mid-scene and stop. Whatever it wrote so far stays as a version.
  async function stopNow() {
    stop()
    if (state.currentId && !state.waiting) await chat.cancel(state.pid, state.currentId).catch(() => {})
  }

  // Step mode decisions, while `waiting`.
  const continueBuild = () => decide?.('continue')
  const continueAll = () => decide?.('continueAll')
  const redo = () => decide?.('redo')
  // Switch a running "build all" to asking after each scene.
  const pauseAfterScene = () => { state.mode = 'step' }

  return { state: readonly(state), buildAll, stop, stopNow, continueBuild, continueAll, redo, pauseAfterScene }
}
