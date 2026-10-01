const analysing = ref(false)
const progress = ref(0)

async function analyse() {
  const { project, setProject } = useEditor()
  const p = project.value
  if (!p?.audio) return
  analysing.value = true
  progress.value = 0
  try {
    const buf = await $fetch<ArrayBuffer>(`/api/projects/${p.id}/files/audio/${p.audio.file}`, { responseType: 'arrayBuffer' })
    const r = await analyzeAudio(buf, v => (progress.value = v))
    setProject(await $fetch(`/api/projects/${p.id}`, { method: 'PATCH', body: { audio: r } }))
  } finally {
    analysing.value = false
  }
}

async function upload(file: File) {
  const { project, setProject } = useEditor()
  const p = project.value
  if (!p) return
  const form = new FormData()
  form.append('file', file)
  setProject(await $fetch(`/api/projects/${p.id}/audio`, { method: 'POST', body: form }))
  await analyse()
}

export function useMusic() {
  return { analysing, progress, analyse, upload }
}
