<script setup lang="ts">
import type { Clip } from '~/composables/useEditor'
import type { Speech } from '~/utils/speech'

const open = defineModel<boolean>('open', { default: false })

const { project, setProject, videoTime, pause, seek, setMode, mode } = useEditor()
const toast = useToast()
const input = ref<HTMLInputElement>()
const addKind = ref<'sfx' | 'voice'>('sfx')
const busy = ref<string | null>(null)
const progress = ref<{ label: string, pct?: number } | null>(null)
const expanded = ref<string | null>(null)

// Generated voice-over (Kokoro, in the browser). Voice and speed are the project's narrator settings,
// shared with the scene scripts Claude writes; useNarration turns those into clips automatically.
const narration = useNarration()
const gen = reactive({ open: false, text: '' })
const narrator = computed(() => project.value?.narrator ?? { voice: 'af_heart', speed: 1 })
const narratorName = computed(() => VOICES.find(v => v.value === narrator.value.voice)?.name ?? narrator.value.voice)
const emit = defineEmits<{ settings: [] }>()
const sceneTitle = (id: string) => project.value?.scenes.find(s => s.id === id)?.title ?? id
let lastSpeech: { key: string, speech: Speech } | null = null
let previewPlayer: HTMLAudioElement | null = null

const pid = computed(() => project.value!.id)
const audio = computed(() => project.value?.audio ?? null)
const clips = computed(() => project.value?.clips ?? [])

// Local copies so sliders feel instant; changes are saved shortly after the last move.
const music = reactive({ gain: 100, fadeIn: 0, fadeOut: 1.5, duck: 35 })
watch(audio, (a) => {
  if (!a) return
  music.gain = Math.round((a.gain ?? 1) * 100)
  music.fadeIn = (a.fadeIn ?? 0) / 1000
  music.fadeOut = (a.fadeOut ?? 0) / 1000
  music.duck = Math.round((a.duck ?? 1) * 100)
}, { immediate: true })

let timer: ReturnType<typeof setTimeout>
function save(body: Record<string, unknown>) {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      setProject(await $fetch(`/api/projects/${pid.value}`, { method: 'PATCH', body }))
    } catch (e: any) {
      toast.add({ title: 'Could not save', description: e?.data?.message, color: 'error' })
    }
  }, 300)
}
const saveMusic = () => save({ audio: { gain: music.gain / 100, fadeIn: Math.round(music.fadeIn * 1000), fadeOut: Math.round(music.fadeOut * 1000), duck: music.duck / 100 } })
const saveClips = (next: Clip[]) => save({ clips: next })

function patchClip(id: string, patch: Partial<Clip>) {
  const next = clips.value.map(c => c.id === id ? { ...c, ...patch } : c)
  project.value!.clips = next
  saveClips(next)
}

function pick(kind: 'sfx' | 'voice') {
  addKind.value = kind
  input.value?.click()
}

function durationOf(file: File) {
  return new Promise<number>((resolve) => {
    const a = new Audio(URL.createObjectURL(file))
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration * 1000 : 0)
    a.onerror = () => resolve(0)
  })
}

async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  busy.value = 'upload'
  try {
    const form = new FormData()
    form.append('file', f)
    form.append('kind', addKind.value)
    form.append('start', String(Math.round(videoTime.value)))
    form.append('duration', String(Math.round(await durationOf(f))))
    const res = await $fetch<{ id: string, project: any }>(`/api/projects/${pid.value}/clips`, { method: 'POST', body: form })
    setProject(res.project)
    toast.add({ title: `${addKind.value === 'voice' ? 'Voice-over' : 'Sound effect'} added at ${fmtSeconds(videoTime.value)}`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not add that file', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    busy.value = null
  }
}

// Generate once per script/voice/speed: Preview then Add reuses the same audio.
async function generateSpeech() {
  const key = JSON.stringify([gen.text.trim(), narrator.value.voice, narrator.value.speed])
  if (lastSpeech?.key === key) return lastSpeech.speech
  busy.value = 'speak'
  progress.value = { label: 'Starting' }
  try {
    const speech = await speak(gen.text, { voice: narrator.value.voice, speed: narrator.value.speed, pronunciations: project.value?.narrator.pronunciations }, (label, pct) => (progress.value = { label, pct }))
    lastSpeech = { key, speech }
    return speech
  } finally {
    busy.value = null
    progress.value = null
  }
}

async function previewVoice() {
  try {
    const { blob } = await generateSpeech()
    previewPlayer?.pause()
    previewPlayer = new Audio(URL.createObjectURL(blob))
    await previewPlayer.play()
  } catch (err: any) {
    toast.add({ title: 'Could not generate the voice', description: err?.message, color: 'error' })
  }
}

async function addVoice() {
  try {
    const { blob, durationMs, captions } = await generateSpeech()
    previewPlayer?.pause()
    const name = gen.text.trim().replace(/\s+/g, ' ').slice(0, 60)
    const form = new FormData()
    form.append('file', new File([blob], `${name.replace(/[^\w ]+/g, '').trim() || 'voice-over'}.wav`, { type: 'audio/wav' }))
    form.append('kind', 'voice')
    form.append('start', String(Math.round(videoTime.value)))
    form.append('duration', String(durationMs))
    busy.value = 'upload'
    const res = await $fetch<{ id: string, project: any }>(`/api/projects/${pid.value}/clips`, { method: 'POST', body: form })
    setProject(res.project)
    patchClip(res.id, { captions })
    expanded.value = res.id
    toast.add({ title: `Voice-over added at ${fmtSeconds(videoTime.value)}`, description: `${fmtSeconds(durationMs, 1)} long, with ${captions.length} caption lines.`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Could not add the voice-over', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    busy.value = null
  }
}

async function remove(c: Clip) {
  setProject(await $fetch(`/api/projects/${pid.value}/clips/${c.id}`, { method: 'DELETE' }))
}

function jumpTo(c: Clip) {
  pause()
  if (mode.value !== 'video') setMode('video')
  seek(c.start)
}

async function runTranscribe(c: Clip) {
  busy.value = c.id
  progress.value = { label: 'Starting' }
  try {
    const captions = await transcribe(`/api/projects/${pid.value}/files/audio/${c.file}`, (label, pct) => (progress.value = { label, pct }))
    patchClip(c.id, { captions })
    expanded.value = c.id
    toast.add({ title: `${captions.length} caption lines from "${c.name}"`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Transcription failed', description: err?.message, color: 'error' })
  } finally {
    busy.value = null
    progress.value = null
  }
}

function editCaption(c: Clip, i: number, patch: Partial<{ start: number, end: number, text: string }>) {
  const list = [...(c.captions ?? [])]
  list[i] = { ...list[i]!, ...patch }
  patchClip(c.id, { captions: list })
}
function removeCaption(c: Clip, i: number) {
  patchClip(c.id, { captions: (c.captions ?? []).filter((_, k) => k !== i) })
}

</script>

<template>
  <USlideover v-model:open="open" title="Sound and captions" :description="FEATURES.music ? 'Music levels, sound effects, voice-over and captions.' : 'Sound effects and voice-over clips on the timeline.'" :ui="{ content: 'max-w-lg' }">
    <template #body>
      <input ref="input" type="file" accept="audio/*" class="hidden" @change="onFile">
      <div class="space-y-6">
        <template v-if="FEATURES.music">
        <!-- Music -->
        <section class="space-y-4">
          <h3 class="flex items-center gap-2 font-semibold text-highlighted"><UIcon name="i-heroicons-musical-note" class="size-4" /> Music</h3>
          <UEmpty v-if="!audio" variant="soft" size="sm" icon="i-heroicons-musical-note" title="No music yet" description="Drop a track anywhere on the editor, or use Add music under the preview." />
          <template v-else>
            <p class="truncate text-sm text-muted">{{ audio.name }}<template v-if="audio.bpm"> · {{ Math.round(audio.bpm) }} BPM</template></p>
            <UFormField :label="`Volume · ${music.gain}%`">
              <USlider v-model="music.gain" :min="0" :max="100" @update:model-value="saveMusic" />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Fade in (s)">
                <UInputNumber v-model="music.fadeIn" :min="0" :max="20" :step="0.25" class="w-full" @update:model-value="saveMusic" />
              </UFormField>
              <UFormField label="Fade out (s)">
                <UInputNumber v-model="music.fadeOut" :min="0" :max="20" :step="0.25" class="w-full" @update:model-value="saveMusic" />
              </UFormField>
            </div>
            <UFormField :label="`Music level under voice-over · ${music.duck}%`" help="100% leaves the music alone.">
              <USlider v-model="music.duck" :min="0" :max="100" @update:model-value="saveMusic" />
            </UFormField>
            <div v-if="audio.sections?.length" class="flex flex-wrap gap-1.5">
              <UBadge v-for="s in audio.sections" :key="s.start" color="neutral" variant="soft" size="sm" :label="`${s.label} ${fmtSeconds(s.start, 1)}`" />
            </div>
          </template>
        </section>

        <USeparator />

        </template>

        <!-- Clips -->
        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <h3 class="flex items-center gap-2 font-semibold text-highlighted"><UIcon name="i-heroicons-speaker-wave" class="size-4" /> Sound clips</h3>
            <UFieldGroup size="xs" class="ml-auto">
              <UButton color="neutral" variant="outline" icon="i-heroicons-bolt" label="Sound effect" :loading="busy === 'upload' && addKind === 'sfx'" @click="pick('sfx')" />
              <UButton color="neutral" variant="outline" icon="i-heroicons-microphone" label="Voice-over" :loading="busy === 'upload' && addKind === 'voice'" @click="pick('voice')" />
              <UButton color="neutral" :variant="gen.open ? 'soft' : 'outline'" icon="i-heroicons-sparkles" label="Generate" @click="gen.open = !gen.open" />
            </UFieldGroup>
          </div>
          <p class="text-xs text-muted">New clips start at the playhead ({{ fmtSeconds(videoTime) }}).</p>

          <UCard v-if="gen.open" :ui="{ body: 'p-3 sm:p-3 space-y-3' }">
            <p class="text-xs text-muted">A one-off line placed at the playhead, spoken by {{ narratorName }} at {{ narrator.speed.toFixed(2) }}× (<UButton variant="link" size="xs" class="p-0" label="change in settings" @click="emit('settings')" />). For narration that follows the scenes, ask Claude instead.</p>
            <UTextarea v-model="gen.text" :rows="3" autoresize class="w-full" placeholder="e.g. Meet Flux. The fastest way to ship your ideas." />
            <div v-if="busy === 'speak' && progress" class="space-y-1">
              <p class="text-xs text-muted">{{ progress.label }}</p>
              <UProgress :model-value="progress.pct ?? null" size="xs" />
            </div>
            <div class="flex items-center gap-2">
              <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-play" label="Preview" :disabled="!gen.text.trim() || !!busy" @click="previewVoice" />
              <UButton size="xs" color="neutral" icon="i-heroicons-plus" label="Add at playhead" :disabled="!gen.text.trim() || !!busy" :loading="busy === 'upload'" @click="addVoice" />
            </div>
          </UCard>
          <UEmpty v-if="!clips.length" variant="soft" size="sm" icon="i-heroicons-speaker-wave" title="No clips" description="Add whooshes, clicks or a voice-over. Voice-over can be transcribed into captions." />
          <UCard v-for="c in clips" :key="c.id" :ui="{ body: 'p-3 sm:p-3 space-y-3' }">
            <div class="flex items-center gap-2">
              <UBadge :color="c.kind === 'voice' ? 'info' : 'warning'" variant="subtle" size="sm" :label="c.kind === 'voice' ? 'Voice' : 'SFX'" />
              <UInput :model-value="c.name" size="sm" variant="ghost" class="min-w-0 flex-1" @update:model-value="v => patchClip(c.id, { name: String(v) })" />
              <UTooltip text="Go to clip"><UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-play" @click="jumpTo(c)" /></UTooltip>
              <UTooltip v-if="c.sceneId" text="Generate the speech again with the current narrator settings"><UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-arrow-path" :loading="narration.state.busy === c.sceneId" @click="narration.regenerate(c.sceneId)" /></UTooltip>
              <UTooltip :text="c.sceneId ? 'Remove the script from the scene to remove this clip' : 'Remove clip'"><UButton size="xs" color="error" variant="ghost" icon="i-heroicons-trash" :disabled="!!c.sceneId" @click="remove(c)" /></UTooltip>
            </div>
            <div v-if="c.sceneId" class="space-y-1">
              <UBadge color="neutral" variant="outline" size="sm" icon="i-heroicons-film" :label="`Scene: ${sceneTitle(c.sceneId)}`" />
              <p class="text-xs text-muted">“{{ c.source?.text }}”<template v-if="c.source?.voice"> · {{ c.source.voice }}</template></p>
            </div>
            <div v-if="!c.sceneId" class="grid grid-cols-[1fr_auto] items-end gap-2">
              <UFormField label="Starts at (s)" size="xs">
                <UInputNumber :model-value="c.start / 1000" :min="0" :step="0.05" size="xs" class="w-full" @update:model-value="v => patchClip(c.id, { start: Math.round((Number(v) || 0) * 1000) })" />
              </UFormField>
              <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-map-pin" label="Playhead" @click="patchClip(c.id, { start: Math.round(videoTime) })" />
            </div>
            <UFormField :label="`Volume · ${Math.round(c.gain * 100)}%`" size="xs">
              <USlider :model-value="Math.round(c.gain * 100)" :min="0" :max="150" size="sm" @update:model-value="v => patchClip(c.id, { gain: Number(v) / 100 })" />
            </UFormField>
            <div v-if="c.kind === 'voice'" class="space-y-2">
              <div class="flex items-center gap-2">
                <UButton size="xs" color="neutral" variant="soft" icon="i-heroicons-language" :label="c.captions?.length ? 'Transcribe again' : 'Transcribe to captions'" :loading="busy === c.id" :disabled="!!busy && busy !== c.id" @click="runTranscribe(c)" />
                <UButton v-if="c.captions?.length" size="xs" color="neutral" variant="ghost" :label="`${c.captions.length} lines`" :trailing-icon="expanded === c.id ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" @click="expanded = expanded === c.id ? null : c.id" />
              </div>
              <div v-if="busy === c.id && progress" class="space-y-1">
                <p class="text-xs text-muted">{{ progress.label }}</p>
                <UProgress :model-value="progress.pct ?? null" size="xs" />
              </div>
              <div v-if="expanded === c.id && c.captions?.length" class="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                <div v-for="(cap, i) in c.captions" :key="i" class="grid grid-cols-[4.5rem_1fr_auto] items-center gap-1.5">
                  <UInputNumber :model-value="cap.start / 1000" :min="0" :step="0.1" size="xs" :increment="false" :decrement="false" @update:model-value="v => editCaption(c, i, { start: Math.round((Number(v) || 0) * 1000) })" />
                  <UInput :model-value="cap.text" size="xs" @update:model-value="v => editCaption(c, i, { text: String(v) })" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" @click="removeCaption(c, i)" />
                </div>
              </div>
            </div>
          </UCard>
        </section>
      </div>
    </template>
  </USlideover>
</template>
