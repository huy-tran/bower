<script setup lang="ts">
interface Job { id: string, status: 'running' | 'encoding' | 'done' | 'error' | 'cancelled', frame: number, total: number, workers: number, format: string, startedAt: number, finishedAt?: number, file?: string, error?: string, label: string }
interface Queued { id: string, label: string, format: string, addedAt: number, position: number }
interface Render { name: string, size: number, at: string }
interface Preset { id: string, name: string, format: 'mp4' | 'gif' | 'mov', fps: number, scale: number, builtIn?: boolean }

const { project, selected } = useEditor()
const toast = useToast()

const range = ref<'video' | 'scene'>('video')
const fps = ref(30)
const scale = ref(1)
const format = ref<'mp4' | 'gif' | 'mov'>('mp4')
const formatItems = [
  { label: 'MP4 video', value: 'mp4', description: 'H.264 with sound. Plays everywhere.' },
  { label: 'Animated GIF', value: 'gif', description: 'No sound, up to 960px wide and 24 fps.' },
  { label: 'ProRes 4444 (transparent)', value: 'mov', description: 'Alpha channel for Premiere, Final Cut or After Effects.' }
]
const job = ref<Job | null>(null)
const queued = ref<Queued[]>([])
const recent = ref<Job[]>([])
const busyElsewhere = ref<{ label: string, frame: number, total: number } | null>(null)
const renders = ref<Render[]>([])
const playing = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout>

// Presets: built-in plus the user's own, shared across projects.
const presets = ref<Preset[]>([])
const presetId = ref<string>('mp4-full')
const presetName = ref('')
const savingPreset = ref(false)
async function loadPresets() { presets.value = await $fetch('/api/render-presets').catch(() => []) }
const presetItems = computed(() => [...presets.value.map(p => ({ label: p.name, value: p.id })), { label: 'Custom', value: 'custom', disabled: true }])
const currentPreset = computed(() => presets.value.find(p => p.id === presetId.value))
function applyPreset(id: string) {
  const p = presets.value.find(x => x.id === id)
  if (!p) return
  format.value = p.format
  fps.value = p.fps
  scale.value = p.scale
  presetId.value = id
}
// Changing a setting by hand turns the preset selector to "Custom".
watch([format, fps, scale], () => {
  const p = currentPreset.value
  if (p && (p.format !== format.value || p.fps !== fps.value || p.scale !== scale.value)) presetId.value = 'custom'
})
async function savePreset() {
  const name = presetName.value.trim()
  if (!name) return
  try {
    const res = await $fetch<{ presets: Preset[] }>('/api/render-presets', { method: 'POST', body: { name, format: format.value, fps: fps.value, scale: scale.value } })
    presets.value = res.presets
    presetId.value = res.presets.at(-1)!.id
    presetName.value = ''
    savingPreset.value = false
    toast.add({ title: `Preset “${name}” saved`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not save the preset', description: e?.data?.message, color: 'error' })
  }
}
async function deletePreset() {
  const p = currentPreset.value
  if (!p || p.builtIn) return
  presets.value = (await $fetch<{ presets: Preset[] }>(`/api/render-presets/${p.id}`, { method: 'DELETE' })).presets
  presetId.value = 'custom'
}

const pid = computed(() => project.value!.id)
const running = computed(() => job.value?.status === 'running' || job.value?.status === 'encoding')
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

const rangeTabs = computed(() => [
  { label: 'Whole video', value: 'video' },
  { label: selected.value?.title ?? 'Scene', value: 'scene' }
])
const fpsItems = [{ label: '24 fps', value: 24 }, { label: '30 fps', value: 30 }, { label: '60 fps', value: 60 }]
const sizeItems = computed(() => [
  { label: `${project.value!.width}×${project.value!.height}`, value: 1 },
  { label: `${project.value!.width / 2}×${project.value!.height / 2} (fast preview)`, value: 0.5 }
])

async function poll() {
  clearTimeout(timer)
  const res = await $fetch<{ job: Job | null, queue: Queued[], recent: Job[], busyElsewhere: typeof busyElsewhere.value, renders: Render[] }>(`/api/projects/${pid.value}/render`)
  const was = job.value?.status
  job.value = res.job
  queued.value = res.queue
  recent.value = res.recent
  busyElsewhere.value = res.busyElsewhere
  renders.value = res.renders
  if (was === 'running' && res.job?.status === 'done') playing.value = res.job.file ?? null
  if (res.job?.status === 'running' || res.job?.status === 'encoding' || res.queue.length || res.busyElsewhere) timer = setTimeout(poll, 700)
}

async function start() {
  try {
    const res = await $fetch<{ queue: Queued[] }>(`/api/projects/${pid.value}/render`, {
      method: 'POST', body: { fps: fps.value, scale: scale.value, format: format.value, sceneId: range.value === 'scene' ? selected.value?.id : undefined }
    })
    if (res.queue.length) toast.add({ title: 'Added to the render queue', description: `Position ${res.queue.at(-1)!.position}. It starts when the current render finishes.`, color: 'neutral' })
    poll()
  } catch (e: any) {
    toast.add({ title: 'Could not start render', description: e?.data?.message, color: 'error' })
  }
}

async function cancel(id?: string) {
  await $fetch(`/api/projects/${pid.value}/render`, { method: 'DELETE', query: id ? { id } : {} })
  poll()
}

async function remove(name: string) {
  const res = await $fetch<{ renders: Render[] }>(`/api/projects/${pid.value}/renders/${name}`, { method: 'DELETE' })
  renders.value = res.renders
  if (playing.value === name) playing.value = null
}

const fileUrl = (name: string) => `/api/projects/${pid.value}/files/renders/${name}`
const kind = (name: string) => name.split('.').pop()
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`
const took = (j: Job) => `${Math.round(((j.finishedAt ?? Date.now()) - j.startedAt) / 1000)}s`
const when = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

watch(pid, () => { job.value = null; playing.value = null; poll() }, { immediate: true })
watch(renders, (r) => { if (!playing.value && r[0]) playing.value = r[0].name })
onMounted(loadPresets)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-6 overflow-hidden bg-muted p-6">
    <div class="flex min-h-0 flex-col gap-4">
      <div class="relative aspect-video w-full overflow-hidden rounded-lg bg-inverted shadow-sm">
        <img v-if="playing && kind(playing) === 'gif'" :key="playing" :src="fileUrl(playing)" alt="GIF render" class="size-full object-contain">
        <video v-else-if="playing" :key="playing" :src="fileUrl(playing)" controls autoplay class="size-full" />
        <UEmpty v-else variant="naked" icon="i-heroicons-film" title="No renders yet" description="Renders show up here." class="size-full justify-center" :ui="{ title: 'text-inverted', description: 'text-dimmed' }" />
      </div>
      <UCard v-if="renders.length" :ui="{ root: 'min-h-0 overflow-y-auto', body: 'p-0 sm:p-0' }">
        <div v-for="r in renders" :key="r.name" class="flex items-center gap-2 border-b border-default px-3 py-2 last:border-0" :class="playing === r.name && 'bg-elevated/50'">
          <UButton
            color="neutral"
            variant="link"
            class="min-w-0 flex-1 font-mono text-xs"
            :icon="playing === r.name ? 'i-heroicons-play-circle' : 'i-heroicons-film'"
            :label="r.name"
            :ui="{ label: 'truncate' }"
            @click="playing = r.name"
          />
          <UBadge color="neutral" variant="soft" size="sm" :label="mb(r.size)" />
          <UTooltip text="Download"><UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-arrow-down-tray" :to="`${fileUrl(r.name)}?download=1`" external target="_blank" /></UTooltip>
          <UTooltip text="Delete"><UButton size="xs" color="error" variant="ghost" icon="i-heroicons-trash" @click="remove(r.name)" /></UTooltip>
        </div>
      </UCard>
    </div>

    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">Export</h2>
        </template>
        <div class="space-y-4">
          <UFormField label="Preset">
            <div class="flex gap-2">
              <USelect :model-value="presetId" :items="presetItems" class="flex-1" @update:model-value="v => applyPreset(String(v))" />
              <UTooltip v-if="currentPreset && !currentPreset.builtIn" text="Delete this preset"><UButton color="neutral" variant="outline" icon="i-heroicons-trash" aria-label="Delete preset" @click="deletePreset" /></UTooltip>
              <UTooltip v-else text="Save the current settings as a preset"><UButton color="neutral" variant="outline" icon="i-heroicons-bookmark" aria-label="Save preset" @click="savingPreset = !savingPreset" /></UTooltip>
            </div>
            <UFieldGroup v-if="savingPreset" class="mt-2 w-full">
              <UInput v-model="presetName" placeholder="Preset name, e.g. Reels 9:16" class="flex-1" autofocus @keydown.enter="savePreset" />
              <UButton color="neutral" label="Save" :disabled="!presetName.trim()" @click="savePreset" />
            </UFieldGroup>
          </UFormField>
          <UFormField label="Range">
            <UTabs v-model="range" :items="rangeTabs" :content="false" color="neutral" size="sm" :ui="{ label: 'truncate' }" />
          </UFormField>
          <UFormField label="Format">
            <USelect v-model="format" :items="formatItems" class="w-full" :ui="{ content: 'min-w-80' }" />
          </UFormField>
          <UFormField label="Frame rate">
            <USelect v-model="fps" :items="fpsItems" class="w-full" />
          </UFormField>
          <UFormField label="Size">
            <USelect v-model="scale" :items="sizeItems" class="w-full" />
          </UFormField>
          <p class="text-xs text-muted">
            {{ frames }} frames rendered in parallel in headless Chrome<template v-if="format !== 'gif' && (project?.audio || project?.clips.length)">, with the sound mixed in</template><template v-if="format === 'mov'">. ProRes files are large; the preview here may not play them</template>.
          </p>

          <div v-if="busyElsewhere" class="rounded-md bg-elevated/60 px-3 py-2 text-xs text-muted">
            Another project is rendering (“{{ busyElsewhere.label }}”, {{ busyElsewhere.frame }} / {{ busyElsewhere.total }} frames). Renders here will queue behind it.
          </div>

          <div v-if="job && (running || !recent.length || job.id === recent[0]?.id)" class="space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="font-medium text-default">
                <template v-if="job.status === 'encoding'">Encoding {{ job.format.toUpperCase() }}…</template>
                <template v-else-if="running">Rendering {{ job.label }} · {{ job.workers }} workers</template>
                <template v-else-if="job.status === 'done'">Done in {{ took(job) }}</template>
                <template v-else-if="job.status === 'cancelled'">Cancelled</template>
                <template v-else>Failed</template>
              </span>
              <span class="font-mono text-xs text-muted">{{ job.frame }} / {{ job.total }}</span>
            </div>
            <UProgress :model-value="pct" :color="job.status === 'error' ? 'error' : 'primary'" />
            <p v-if="eta" class="text-xs text-muted">{{ eta }}</p>
            <UAlert v-if="job.error" color="error" variant="subtle" icon="i-heroicons-exclamation-triangle" title="Render failed" :description="job.error" :ui="{ description: 'font-mono text-xs break-words' }" />
          </div>

          <div v-if="queued.length" class="space-y-1">
            <p class="text-xs font-medium text-muted">Queued</p>
            <div v-for="q in queued" :key="q.id" class="flex items-center gap-2 rounded-md bg-elevated/60 px-2 py-1 text-xs">
              <UBadge color="neutral" variant="soft" size="sm" :label="`#${q.position}`" />
              <span class="min-w-0 flex-1 truncate">{{ q.label }} · {{ q.format.toUpperCase() }}</span>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" :aria-label="`Remove ${q.label} from the queue`" @click="cancel(q.id)" />
            </div>
          </div>

          <div v-if="recent.length > 1" class="space-y-1">
            <p class="text-xs font-medium text-muted">Recent</p>
            <div v-for="r in recent.slice(1, 6)" :key="r.id" class="flex items-center gap-2 text-xs text-muted">
              <UIcon :name="r.status === 'done' ? 'i-heroicons-check-circle' : r.status === 'cancelled' ? 'i-heroicons-minus-circle' : 'i-heroicons-x-circle'" class="size-3.5 shrink-0" :class="r.status === 'done' ? 'text-success' : r.status === 'error' ? 'text-error' : 'text-dimmed'" />
              <span class="min-w-0 flex-1 truncate">{{ r.label }} · {{ r.format.toUpperCase() }}</span>
              <span class="shrink-0">{{ when(r.startedAt) }} · {{ r.status === 'done' ? took(r) : r.status }}</span>
            </div>
          </div>
        </div>
        <template #footer>
          <UButton v-if="running" block color="neutral" variant="outline" label="Cancel render" @click="cancel()" />
          <UButton v-else block icon="i-heroicons-film" :label="busyElsewhere || queued.length ? 'Add to queue' : 'Render'" @click="start" />
        </template>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">Web player</h2>
        </template>
        <p class="text-xs text-muted">
          One .html file with every scene<template v-if="project?.audio"> and the music</template> built in. It plays in any browser with no server,
          so you can email it, drop it in Slack, or host it anywhere (Netlify Drop, S3, your site).
        </p>
        <template #footer>
          <div class="flex gap-2">
            <UButton class="flex-1 justify-center" color="neutral" icon="i-heroicons-arrow-down-tray" label="Download" :to="`/api/projects/${pid}/player?download=1`" external />
            <UButton color="neutral" variant="outline" icon="i-heroicons-arrow-top-right-on-square" label="Preview" :to="`/api/projects/${pid}/player`" external target="_blank" />
          </div>
        </template>
      </UCard>
    </div>
  </div>
</template>
