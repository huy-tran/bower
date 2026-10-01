<script setup lang="ts">
interface Job { status: 'running' | 'done' | 'error' | 'cancelled', frame: number, total: number, startedAt: number, finishedAt?: number, file?: string, error?: string, label: string }
interface Render { name: string, size: number, at: string }

const { project, selected } = useEditor()
const toast = useToast()

const range = ref<'video' | 'scene'>('video')
const fps = ref(30)
const scale = ref(1)
const job = ref<Job | null>(null)
const renders = ref<Render[]>([])
const playing = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout>

const pid = computed(() => project.value!.id)
const running = computed(() => job.value?.status === 'running')
const pct = computed(() => job.value?.total ? Math.round(job.value.frame / job.value.total * 100) : 0)
const eta = computed(() => {
  const j = job.value
  if (!j || !j.frame || j.status !== 'running') return ''
  const per = (Date.now() - j.startedAt) / j.frame
  const s = Math.round((j.total - j.frame) * per / 1000)
  return s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s left` : `${s}s left`
})
const frames = computed(() => {
  const d = range.value === 'scene' ? selected.value?.duration ?? 0 : project.value?.duration ?? 0
  return Math.round(d / 1000 * fps.value)
})

async function poll() {
  clearTimeout(timer)
  const res = await $fetch<{ job: Job | null, renders: Render[] }>(`/api/projects/${pid.value}/render`)
  const was = job.value?.status
  job.value = res.job
  renders.value = res.renders
  if (was === 'running' && res.job?.status === 'done') playing.value = res.job.file ?? null
  if (res.job?.status === 'running') timer = setTimeout(poll, 700)
}

async function start() {
  try {
    const res = await $fetch<{ job: Job }>(`/api/projects/${pid.value}/render`, {
      method: 'POST', body: { fps: fps.value, scale: scale.value, sceneId: range.value === 'scene' ? selected.value?.id : undefined }
    })
    job.value = res.job
    poll()
  } catch (e: any) {
    toast.add({ title: 'Could not start render', description: e?.data?.message, color: 'error' })
  }
}

async function cancel() {
  await $fetch(`/api/projects/${pid.value}/render`, { method: 'DELETE' })
  poll()
}

async function remove(name: string) {
  const res = await $fetch<{ renders: Render[] }>(`/api/projects/${pid.value}/renders/${name}`, { method: 'DELETE' })
  renders.value = res.renders
  if (playing.value === name) playing.value = null
}

const fileUrl = (name: string) => `/api/projects/${pid.value}/files/renders/${name}`
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`

watch(pid, () => { job.value = null; playing.value = null; poll() }, { immediate: true })
watch(renders, (r) => { if (!playing.value && r[0]) playing.value = r[0].name })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="grid min-h-0 flex-1 grid-cols-[1fr_340px] gap-6 overflow-hidden p-6">
    <div class="flex min-h-0 flex-col gap-4">
      <div class="relative aspect-video w-full overflow-hidden rounded-lg bg-zinc-900 shadow-sm">
        <video v-if="playing" :key="playing" :src="fileUrl(playing)" controls autoplay class="size-full" />
        <div v-else class="grid size-full place-items-center text-sm text-zinc-400">
          <span class="flex flex-col items-center gap-2"><UIcon name="i-lucide-clapperboard" class="size-8" /> Renders show up here</span>
        </div>
      </div>
      <div v-if="renders.length" class="min-h-0 overflow-y-auto rounded-lg bg-white ring-1 ring-zinc-200">
        <div v-for="r in renders" :key="r.name" class="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5 text-sm last:border-0" :class="playing === r.name && 'bg-zinc-50'">
          <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="playing = r.name">
            <UIcon :name="playing === r.name ? 'i-lucide-circle-play' : 'i-lucide-film'" class="size-4 shrink-0 text-zinc-500" />
            <span class="truncate font-mono text-xs text-zinc-700">{{ r.name }}</span>
          </button>
          <span class="text-xs text-zinc-400">{{ mb(r.size) }}</span>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-download" :to="`${fileUrl(r.name)}?download=1`" external target="_blank" />
          <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="remove(r.name)" />
        </div>
      </div>
    </div>

    <div class="space-y-5 rounded-lg bg-white p-5 ring-1 ring-zinc-200">
      <h2 class="text-base font-semibold text-zinc-900">Export MP4</h2>
      <UFormField label="Range">
        <div class="flex rounded-lg bg-zinc-100 p-0.5 text-sm">
          <button class="flex-1 rounded-md px-3 py-1.5" :class="range === 'video' ? 'bg-white font-medium shadow-sm' : 'text-zinc-500'" @click="range = 'video'">Whole video</button>
          <button class="flex-1 truncate rounded-md px-3 py-1.5" :class="range === 'scene' ? 'bg-white font-medium shadow-sm' : 'text-zinc-500'" @click="range = 'scene'">{{ selected?.title ?? 'Scene' }}</button>
        </div>
      </UFormField>
      <UFormField label="Frame rate">
        <USelect v-model="fps" :items="[{ label: '24 fps', value: 24 }, { label: '30 fps', value: 30 }, { label: '60 fps', value: 60 }]" class="w-full" />
      </UFormField>
      <UFormField label="Size">
        <USelect v-model="scale" :items="[{ label: `${project!.width}×${project!.height}`, value: 1 }, { label: `${project!.width / 2}×${project!.height / 2} (fast preview)`, value: 0.5 }]" class="w-full" />
      </UFormField>
      <p class="text-xs text-zinc-500">
        {{ frames }} frames, each rendered in headless Chrome and encoded with H.264<template v-if="project?.audio">, with the music track</template>.
      </p>

      <div v-if="job" class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span class="font-medium text-zinc-700">
            <template v-if="running">Rendering {{ job.label }}…</template>
            <template v-else-if="job.status === 'done'">Done in {{ Math.round(((job.finishedAt ?? 0) - job.startedAt) / 1000) }}s</template>
            <template v-else-if="job.status === 'cancelled'">Cancelled</template>
            <template v-else>Failed</template>
          </span>
          <span class="font-mono text-xs text-zinc-500">{{ job.frame }} / {{ job.total }}</span>
        </div>
        <UProgress :model-value="pct" :color="job.status === 'error' ? 'error' : 'neutral'" />
        <p v-if="eta" class="text-xs text-zinc-500">{{ eta }}</p>
        <p v-if="job.error" class="rounded-md bg-red-50 p-2 font-mono text-xs break-words text-red-700">{{ job.error }}</p>
      </div>

      <UButton v-if="running" block color="neutral" variant="outline" label="Cancel render" @click="cancel" />
      <UButton v-else block color="neutral" icon="i-lucide-clapperboard" label="Render" @click="start" />

      <div class="space-y-3 border-t border-zinc-100 pt-5">
        <h2 class="text-base font-semibold text-zinc-900">Web player</h2>
        <p class="text-xs text-zinc-500">
          One .html file with every scene<template v-if="project?.audio"> and the music</template> built in. It plays in any browser with no server,
          so you can email it, drop it in Slack, or host it anywhere (Netlify Drop, S3, your site).
        </p>
        <div class="flex gap-2">
          <UButton class="flex-1" color="neutral" icon="i-lucide-download" label="Download" :to="`/api/projects/${pid}/player?download=1`" external />
          <UButton color="neutral" variant="outline" icon="i-lucide-external-link" label="Preview" :to="`/api/projects/${pid}/player`" external target="_blank" />
        </div>
      </div>
    </div>
  </div>
</template>
