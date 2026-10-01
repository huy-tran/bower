<script setup lang="ts">
// Plan a video: a brief in, a scene list out (drafted by Claude, edited here), then scenes are created and built.
interface PlanScene { title: string, duration: number, brief: string, voice: string }

const open = defineModel<boolean>('open', { default: false })
const { project } = useEditor()
const ed = useEditor()
const story = useStoryboard()
const toast = useToast()

const step = ref<'brief' | 'plan'>('brief')
// With no target length (the default) Claude sizes the video to the brief.
const form = reactive({ brief: '', autoLength: true, seconds: 45, narration: true })
const planning = ref(false)
const activity = ref('')
const scenes = ref<PlanScene[]>([])
const mode = ref<'replace' | 'append'>('replace')
const build = ref<'all' | 'step' | 'none'>('all')
const buildItems = [
  { label: 'Build every scene now', description: 'Claude works through the scenes one after another.', value: 'all' },
  { label: 'Build one scene at a time', description: 'Claude pauses after each scene so you can review it, redo it or stop.', value: 'step' },
  { label: 'Just create the scenes', description: 'Each scene keeps its brief; build them from their chats when you are ready.', value: 'none' }
]
const applying = ref(false)

const total = computed(() => scenes.value.reduce((a, s) => a + s.duration, 0))
const words = (s: string) => s.trim() ? s.trim().split(/\s+/).length : 0
const tooLong = (s: PlanScene) => s.voice && words(s.voice) > s.duration / 400 + 1

watch(open, (o) => { if (o && !scenes.value.length) step.value = 'brief' })

async function plan() {
  if (!form.brief.trim()) return
  planning.value = true
  activity.value = 'Starting Claude…'
  const pid = project.value!.id
  try {
    await $fetch(`/api/projects/${pid}/storyboard`, { method: 'POST', body: { brief: form.brief, seconds: form.autoLength ? undefined : form.seconds, narration: form.narration } })
    for (;;) {
      await new Promise(r => setTimeout(r, 1500))
      const j = await $fetch<{ status: string, activity: string[], plan?: PlanScene[], error?: string }>(`/api/projects/${pid}/storyboard`)
      activity.value = j.activity.at(-1) ?? ''
      if (j.status === 'running') continue
      if (j.status === 'error' || !j.plan) throw new Error(j.error || 'No plan came back')
      scenes.value = j.plan
      step.value = 'plan'
      break
    }
  } catch (err: any) {
    toast.add({ title: 'Could not plan the video', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    planning.value = false
  }
}

function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= scenes.value.length) return
  const list = [...scenes.value]
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  scenes.value = list
}
function remove(i: number) { scenes.value.splice(i, 1) }
function add() { scenes.value.push({ title: 'New scene', duration: 4000, brief: '', voice: '' }) }

async function apply() {
  if (!scenes.value.length) return
  applying.value = true
  const pid = project.value!.id
  try {
    const res = await $fetch<{ created: string[], project: any }>(`/api/projects/${pid}/storyboard`, { method: 'PUT', body: { scenes: scenes.value, mode: mode.value } })
    ed.setProject(res.project)
    open.value = false
    const note = { all: 'Claude is building them one by one. Watch the scene strip.', step: 'Claude builds the first scene, then asks you in the header before going on.', none: 'Each scene holds its brief. Open a scene and ask Claude to build it.' }
    toast.add({ title: `${res.created.length} scenes created`, description: note[build.value], color: 'success' })
    if (build.value !== 'none') story.buildAll(pid, res.created, build.value)
    scenes.value = []
    step.value = 'brief'
  } catch (err: any) {
    toast.add({ title: 'Could not create the scenes', description: err?.data?.message || err?.message, color: 'error' })
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Storyboard" :description="step === 'brief' ? 'Describe the video. Claude drafts the scenes; you shape them before anything is built.' : 'Edit titles, timing, briefs and narration, then create the scenes.'" :ui="{ content: 'max-w-4xl', footer: 'justify-between' }">
    <template #body>
      <div v-if="step === 'brief'" class="space-y-4">
        <UFormField label="Brief" help="Who it is for, what it should get across, the tone, and anything it must include or avoid. Claude also reads the art direction, brand kit, linked code and app notes.">
          <UTextarea v-model="form.brief" :rows="7" autoresize class="w-full" placeholder="e.g. A 45-second launch teaser for the new booking flow, aimed at clinic managers. Calm and confident. Show the three steps: pick a slot, confirm the patient, send the reminder. End on the logo and the line “Less admin. More care.”" />
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField :label="form.autoLength ? 'Target length' : `Target length · ${form.seconds}s`">
            <USwitch v-model="form.autoLength" label="Let Claude choose from the brief" />
            <USlider v-if="!form.autoLength" v-model="form.seconds" :min="10" :max="300" :step="5" class="mt-3" />
          </UFormField>
          <UFormField label="Narration">
            <USwitch v-model="form.narration" label="Write a voice-over line for each scene" />
          </UFormField>
        </div>
        <div v-if="planning" class="space-y-1">
          <p class="text-xs text-muted">{{ activity }}</p>
          <UProgress :model-value="null" size="xs" />
        </div>
      </div>

      <div v-else class="space-y-3">
        <div class="flex items-center gap-3 text-sm text-muted">
          <span>{{ scenes.length }} scene{{ scenes.length === 1 ? '' : 's' }} · {{ fmtSeconds(total, 0) }} total</span>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-plus" label="Add scene" class="ml-auto" @click="add" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-arrow-uturn-left" label="Back to brief" @click="step = 'brief'" />
        </div>
        <div class="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          <UCard v-for="(s, i) in scenes" :key="i" :ui="{ body: 'p-3 sm:p-3 space-y-2' }">
            <div class="flex items-center gap-2">
              <UBadge color="neutral" variant="soft" size="sm" :label="String(i + 1)" />
              <UInput v-model="s.title" size="sm" class="min-w-0 flex-1 font-semibold" placeholder="Title" />
              <UInputNumber :model-value="s.duration / 1000" :min="0.5" :max="60" :step="0.5" size="sm" class="w-28" :format-options="{ style: 'unit', unit: 'second', unitDisplay: 'narrow' }" @update:model-value="v => (s.duration = Math.round((Number(v) || 1) * 1000))" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-chevron-up" :disabled="i === 0" aria-label="Move up" @click="move(i, -1)" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-chevron-down" :disabled="i === scenes.length - 1" aria-label="Move down" @click="move(i, 1)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-heroicons-x-mark" aria-label="Remove scene" @click="remove(i)" />
            </div>
            <UTextarea v-model="s.brief" :rows="2" autoresize size="sm" class="w-full" placeholder="What is on screen and how it moves" />
            <div class="flex items-start gap-2">
              <UIcon name="i-heroicons-microphone" class="mt-2 size-4 shrink-0 text-muted" />
              <UTextarea v-model="s.voice" :rows="1" autoresize size="sm" class="w-full" placeholder="Voice-over line (optional)" />
            </div>
            <p v-if="tooLong(s)" class="text-xs text-warning">About {{ words(s.voice) }} words for {{ fmtSeconds(s.duration, 1) }}: this line will likely run longer than the scene. Shorten it or lengthen the scene.</p>
          </UCard>
        </div>
        <div class="grid gap-4 border-t border-default pt-3 sm:grid-cols-2">
          <URadioGroup v-model="mode" legend="Placement" :items="[{ label: 'Replace the current scenes (they go to the trash)', value: 'replace' }, { label: 'Add after the current scenes', value: 'append' }]" />
          <URadioGroup v-model="build" legend="Building" :items="buildItems" />
        </div>
      </div>
    </template>
    <template #footer>
      <span />
      <div class="flex gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton v-if="step === 'brief'" icon="i-heroicons-sparkles" label="Plan with Claude" :loading="planning" :disabled="!form.brief.trim()" @click="plan" />
        <UButton v-else icon="i-heroicons-squares-plus" :label="build === 'none' ? 'Create scenes' : 'Create and build'" :loading="applying" :disabled="!scenes.length" @click="apply" />
      </div>
    </template>
  </UModal>
</template>
