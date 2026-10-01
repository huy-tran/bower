<script setup lang="ts">
// Audition the narrator voices: one sample line, every voice a click away, a star to shortlist, Use to pick.
// Samples are generated in the browser on demand and kept for the session.
const open = defineModel<boolean>('open', { default: false })

const { project, setProject } = useEditor()
const toast = useToast()

const DEFAULT_LINE = 'Meet Flux. The fastest way to ship your ideas, from the first sketch to the final launch.'
const sample = ref('')
const speed = ref(1)
const generating = ref<string | null>(null) // voice being generated
const playingVoice = ref<string | null>(null)
const auditioning = ref(false)
const progress = ref<{ label: string, pct?: number } | null>(null)

const cache = new Map<string, string>() // key -> object URL
let player: HTMLAudioElement | null = null
let stopAll = false

const narrator = computed(() => project.value?.narrator ?? { voice: 'af_heart', speed: 1, shortlist: [] as string[] })
const shortlist = computed(() => narrator.value.shortlist)
const ordered = computed(() => [...VOICES].sort((a, b) => Number(shortlist.value.includes(b.value)) - Number(shortlist.value.includes(a.value))))

watch(open, (v) => {
  if (v) {
    // Audition with the real script when there is one, so the choice is made on the actual words.
    sample.value ||= project.value?.scenes.find(s => s.voice)?.voice?.text.slice(0, 200) || DEFAULT_LINE
    speed.value = narrator.value.speed
  } else {
    stop()
  }
})

const key = (v: string) => JSON.stringify([sample.value.trim(), v, speed.value])

async function sampleUrl(v: string) {
  const k = key(v)
  const hit = cache.get(k)
  if (hit) return hit
  generating.value = v
  progress.value = { label: 'Starting' }
  try {
    const { blob } = await speak(sample.value, { voice: v, speed: speed.value, pronunciations: project.value?.narrator.pronunciations }, (label, pct) => (progress.value = { label, pct }))
    const url = URL.createObjectURL(blob)
    cache.set(k, url)
    return url
  } finally {
    generating.value = null
    progress.value = null
  }
}

function stop() {
  stopAll = true
  auditioning.value = false
  player?.pause()
  player = null
  playingVoice.value = null
}

function playUrl(url: string, v: string) {
  return new Promise<void>((resolve) => {
    player?.pause()
    const a = new Audio(url)
    player = a
    playingVoice.value = v
    a.onended = a.onerror = () => { if (player === a) { player = null; playingVoice.value = null }; resolve() }
    a.play().catch(() => resolve())
  })
}

async function play(v: string) {
  if (playingVoice.value === v) return stop()
  if (!sample.value.trim()) return toast.add({ title: 'Type a sample line first', color: 'warning' })
  stopAll = false
  try {
    await playUrl(await sampleUrl(v), v)
  } catch (err: any) {
    toast.add({ title: 'Could not generate the sample', description: err?.message, color: 'error' })
  }
}

// Play every voice in turn (shortlisted first) so they can be compared back to back.
async function auditionAll() {
  if (auditioning.value) return stop()
  if (!sample.value.trim()) return toast.add({ title: 'Type a sample line first', color: 'warning' })
  stopAll = false
  auditioning.value = true
  try {
    for (const v of ordered.value) {
      if (stopAll) break
      const url = await sampleUrl(v.value)
      if (stopAll) break
      await playUrl(url, v.value)
      await new Promise(r => setTimeout(r, 350))
    }
  } catch (err: any) {
    toast.add({ title: 'Could not generate a sample', description: err?.message, color: 'error' })
  } finally {
    auditioning.value = false
  }
}

async function patch(body: Record<string, unknown>) {
  try {
    setProject(await $fetch(`/api/projects/${project.value!.id}`, { method: 'PATCH', body: { narrator: body } }))
  } catch (e: any) {
    toast.add({ title: 'Could not save', description: e?.data?.message, color: 'error' })
  }
}

function toggleStar(v: string) {
  const list = shortlist.value.includes(v) ? shortlist.value.filter(x => x !== v) : [...shortlist.value, v]
  patch({ shortlist: list })
}

async function use(v: string) {
  await patch({ voice: v, speed: speed.value })
  toast.add({ title: `${VOICES.find(x => x.value === v)?.name} is now the narrator`, description: 'New and edited scene scripts use it. Regenerate existing clips from the Sound panel if you want them redone.', color: 'success' })
}
</script>

<template>
  <UModal v-model:open="open" title="Audition voices" description="Listen to each voice on your own line, star the ones you like, and pick the narrator." :ui="{ content: 'max-w-2xl', footer: 'justify-between' }">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Sample line" help="Use a real line from the script: voices read differently on different words.">
          <UTextarea v-model="sample" :rows="2" autoresize class="w-full" :placeholder="DEFAULT_LINE" />
        </UFormField>
        <div class="flex items-center gap-4">
          <UFormField :label="`Speed · ${speed.toFixed(2)}×`" class="flex-1">
            <USlider v-model="speed" :min="0.7" :max="1.3" :step="0.05" class="mt-2" />
          </UFormField>
          <UButton color="neutral" :variant="auditioning ? 'soft' : 'outline'" :icon="auditioning ? 'i-heroicons-stop' : 'i-heroicons-play'" :label="auditioning ? 'Stop' : 'Play all'" :disabled="!!generating && !auditioning" @click="auditionAll" />
        </div>
        <div v-if="generating && progress" class="space-y-1">
          <p class="text-xs text-muted">{{ progress.label }} · {{ VOICES.find(v => v.value === generating)?.name }}</p>
          <UProgress :model-value="progress.pct ?? null" size="xs" />
        </div>

        <div data-voice-list class="max-h-[50vh] divide-y divide-default overflow-y-auto rounded-lg border border-default">
          <div v-for="v in ordered" :key="v.value" :data-voice="v.value" :data-playing="playingVoice === v.value || undefined" class="flex items-center gap-3 px-3 py-2" :class="{ 'bg-elevated/50': playingVoice === v.value }">
            <UButton size="sm" :color="playingVoice === v.value ? 'primary' : 'neutral'" :variant="playingVoice === v.value ? 'solid' : 'outline'" :icon="playingVoice === v.value ? 'i-heroicons-stop' : 'i-heroicons-play'" :loading="generating === v.value" :disabled="!!generating && generating !== v.value" :aria-label="`Play ${v.name}`" @click="play(v.value)" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-medium">{{ v.name }}</span>
                <UBadge color="neutral" variant="soft" size="sm" :label="`${v.accent} ${v.gender.toLowerCase()}`" />
                <UBadge v-if="narrator.voice === v.value" color="info" variant="subtle" size="sm" label="Narrator" />
              </div>
              <p class="truncate text-xs text-muted">{{ v.note }} · quality {{ v.grade }}</p>
            </div>
            <UTooltip :text="shortlist.includes(v.value) ? 'Remove from shortlist' : 'Shortlist'">
              <UButton size="sm" :color="shortlist.includes(v.value) ? 'warning' : 'neutral'" variant="ghost" :icon="shortlist.includes(v.value) ? 'i-heroicons-star-solid' : 'i-heroicons-star'" :aria-label="`Shortlist ${v.name}`" @click="toggleStar(v.value)" />
            </UTooltip>
            <UButton size="sm" color="neutral" :variant="narrator.voice === v.value ? 'soft' : 'outline'" :label="narrator.voice === v.value ? 'In use' : 'Use'" :disabled="narrator.voice === v.value" @click="use(v.value)" />
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <p v-if="shortlist.length" class="text-xs text-muted">{{ shortlist.length }} shortlisted: {{ shortlist.map(s => VOICES.find(v => v.value === s)?.name).join(', ') }}. Claude prefers these for per-scene voices.</p>
      <span v-else />
      <UButton color="neutral" label="Done" @click="open = false" />
    </template>
  </UModal>
</template>
