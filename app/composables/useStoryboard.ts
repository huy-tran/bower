// Builds storyboard scenes one after another through the per-scene chat, so each gets Claude's full attention
// and the scene strip shows which one is being worked on.
const state = reactive({
  building: false,
  pid: '',
  queue: [] as string[],
  done: 0,
  total: 0,
  current: '' as string,
  stopRequested: false
})

export const BUILD_PROMPT = 'Build this scene from its storyboard brief (the "brief" key in the meta block). Replace the placeholder with the real scene: layout, typography, imagery and motion that fully deliver the brief, keeping the duration and timing anything spoken to the narration if there is one. Use the brand kit, linked codebases and the running product where they apply.'

export function useStoryboard() {
  const ed = useEditor()
  const chat = useChat()
  const toast = useToast()

  async function buildAll(pid: string, sceneIds: string[]) {
    if (state.building) return
    Object.assign(state, { building: true, pid, queue: [...sceneIds], done: 0, total: sceneIds.length, current: '', stopRequested: false })
    try {
      while (state.queue.length && !state.stopRequested) {
        const id = state.queue.shift()!
        const scene = ed.project.value?.scenes.find(s => s.id === id)
        if (!scene || ed.project.value?.id !== pid) continue
        state.current = scene.title
        try {
          await chat.send(pid, id, BUILD_PROMPT)
          while (chat.isBusy(pid, id)) await new Promise(r => setTimeout(r, 1000))
        } catch (err: any) {
          toast.add({ title: `Could not build “${scene.title}”`, description: err?.data?.message || err?.message, color: 'error' })
        }
        state.done++
      }
      if (!state.stopRequested) toast.add({ title: 'Storyboard built', description: `${state.done} scene${state.done === 1 ? '' : 's'} done. Review each one and ask for changes in its chat.`, color: 'success', duration: 8000 })
    } finally {
      state.building = false
      state.current = ''
    }
  }

  function stop() {
    state.stopRequested = true
    state.queue = []
  }

  return { state: readonly(state), buildAll, stop }
}
