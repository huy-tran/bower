<script setup lang="ts">
import type { Seam } from '~/composables/useEditor'

const { project, selected, select, setProject } = useEditor()
const chat = useChat()
const narration = useNarration()

// Narration mark on a scene with a script: queued, generating, done (or over length) or failed.
function voiceIcon(id: string) {
  const st = narration.statusOf(id)?.state
  return st === 'generating' ? 'i-heroicons-arrow-path' : st === 'failed' ? 'i-heroicons-exclamation-triangle' : st === 'queued' ? 'i-heroicons-clock' : 'i-heroicons-microphone'
}
function voiceColor(id: string) {
  const st = narration.statusOf(id)
  return st?.state === 'failed' ? 'error' : st?.state === 'done' && st.overBy > 50 ? 'warning' : st?.state === 'done' ? 'success' : 'info'
}
function voiceTip(id: string) {
  const st = narration.statusOf(id)
  if (!st) return ''
  if (st.state === 'done') return `Narrated · ${fmtSeconds(st.durationMs, 1)}${st.overBy > 50 ? ` (${fmtSeconds(st.overBy, 1)} longer than the scene)` : ''}`
  if (st.state === 'generating') return `Narrating · ${st.label}${st.pct ? ` ${Math.round(st.pct)}%` : ''}`
  if (st.state === 'failed') return `Narration failed · ${st.error}`
  return 'Narration queued'
}
const toast = useToast()

const dragId = ref<string | null>(null)
const overId = ref<string | null>(null)
const adding = ref(false)
const picking = ref(false)
const form = reactive({ title: '', brief: '' })
const strip = ref<HTMLElement>()

function onDragStart(id: string, e: DragEvent) {
  dragId.value = id
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', id)
}

async function onDrop(targetId: string) {
  const p = project.value!
  const from = dragId.value
  dragId.value = overId.value = null
  if (!from || from === targetId) return
  const ids = p.scenes.map(s => s.id).filter(id => id !== from)
  ids.splice(ids.indexOf(targetId) + (p.scenes.findIndex(s => s.id === from) < p.scenes.findIndex(s => s.id === targetId) ? 1 : 0), 0, from)
  setProject(await $fetch(`/api/projects/${p.id}/scenes/order`, { method: 'PUT', body: { ids } }))
}

async function addScene() {
  const p = project.value!
  const title = form.title.trim() || 'New scene'
  const res = await $fetch<{ id: string, project: any }>(`/api/projects/${p.id}/scenes`, {
    method: 'POST', body: { title, afterId: selected.value?.id }
  })
  setProject(res.project)
  select(res.id)
  adding.value = false
  const brief = form.brief.trim()
  form.title = form.brief = ''
  if (brief) {
    chat.send(p.id, res.id, `Build this scene from scratch: ${brief}`).catch(e => toast.add({ title: 'Could not start Claude', description: e.data?.message, color: 'error' }))
  }
}

// Thumbnails share one height; width follows the project's shape (wide, square or portrait).
const thumb = computed(() => {
  const p = project.value!
  const h = 135
  return { height: `${h}px`, width: `${Math.round(Math.min(240, h * p.width / p.height))}px`, marginInline: 'auto' }
})

const slotWidth = computed(() => `${Math.max(150, parseInt(thumb.value.width))}px`)

// Seam scores for every cut, re-checked (debounced) whenever a scene file or transition changes.
const seams = ref(new Map<string, Seam>())
let seamTimer: ReturnType<typeof setTimeout>
watch(() => project.value && `${project.value.id}|${project.value.scenes.map(s => `${s.id}:${s.mtime}:${s.duration}:${s.transition?.type ?? ''}`).join(',')}`, (key) => {
  clearTimeout(seamTimer)
  if (!key || project.value!.scenes.length < 2) return
  const pid = project.value!.id
  seamTimer = setTimeout(async () => {
    const res = await $fetch<{ seams: Seam[] }>(`/api/projects/${pid}/seams`).catch(() => null)
    if (res && project.value?.id === pid) seams.value = new Map(res.seams.map(x => [`${x.from}>${x.to}`, x]))
  }, 1200)
}, { immediate: true })

watch(() => selected.value?.id, async (id) => {
  await nextTick()
  strip.value?.querySelector(`[data-scene="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
})
</script>

<template>
  <div v-if="project" ref="strip" class="flex items-stretch overflow-x-auto px-6 pt-3 pb-4">
    <template v-for="(s, i) in project.scenes" :key="s.id">
    <SceneGap v-if="i > 0" :from="project.scenes[i - 1]!" :to="s" :seam="seams.get(`${project.scenes[i - 1]!.id}>${s.id}`)" />
    <div
      :data-scene="s.id"
      class="shrink-0 cursor-pointer"
      :style="{ width: slotWidth }"
      draggable="true"
      @click="select(s.id)"
      @dragstart="onDragStart(s.id, $event)"
      @dragover.prevent="overId = s.id"
      @dragleave="overId === s.id && (overId = null)"
      @drop.prevent="onDrop(s.id)"
      @dragend="dragId = overId = null"
    >
      <div
        class="relative overflow-hidden rounded-md bg-white ring-1 transition"
        :style="thumb"
        :class="[
          s.id === selected?.id ? 'ring-2 ring-primary' : 'ring-default hover:ring-accented',
          overId === s.id && dragId !== s.id && 'ring-2 ring-inverted',
          dragId === s.id && 'opacity-40'
        ]"
      >
        <iframe :src="frameUrl(project.id, s, s.duration * 0.6)" class="pointer-events-none size-full border-0" loading="lazy" tabindex="-1" />
        <UBadge class="absolute top-2 left-2" color="neutral" size="sm" :label="String(i + 1)" />
        <UBadge
          v-if="chat.isBusy(project.id, s.id)"
          class="absolute top-2 right-2"
          color="primary"
          variant="subtle"
          size="sm"
          icon="i-heroicons-arrow-path"
          label="Working"
          :ui="{ leadingIcon: 'animate-spin' }"
        />
        <UTooltip v-if="s.voice" :text="voiceTip(s.id)">
          <UBadge
            class="absolute bottom-2 right-2"
            :color="voiceColor(s.id)"
            variant="subtle"
            size="sm"
            :icon="voiceIcon(s.id)"
            :ui="{ leadingIcon: narration.statusOf(s.id)?.state === 'generating' ? 'animate-spin' : '' }"
          />
        </UTooltip>
      </div>
      <div class="mt-1.5 flex items-baseline gap-2 text-sm">
        <span class="truncate font-medium text-highlighted">{{ s.title }}</span>
        <span class="ml-auto shrink-0 text-dimmed">{{ fmtSeconds(s.duration) }}</span>
      </div>
    </div>
    </template>

    <UButton
      color="neutral"
      variant="outline"
      icon="i-heroicons-plus"
      label="Add scene"
      class="ml-4 h-[135px] w-40 shrink-0 flex-col justify-center border-2 border-dashed border-accented ring-0"
      @click="adding = true"
    />

    <UModal v-model:open="adding" title="New scene" description="Added after the current scene." :ui="{ footer: 'justify-end' }">
      <template #body>
        <UForm id="new-scene" :state="form" class="space-y-4" @submit="addScene">
          <UFormField label="Title" name="title">
            <UInput v-model="form.title" placeholder="e.g. Dark mode" autofocus class="w-full" />
          </UFormField>
          <UFormField label="Brief (optional)" name="brief" help="If you describe the scene, Claude builds it straight away.">
            <UTextarea v-model="form.brief" :rows="4" autoresize placeholder="Headline 'Dark by default' slides up, then the settings card flips from light to dark on the downbeat." class="w-full" />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" icon="i-heroicons-bookmark" label="From a template…" class="mr-auto" @click="adding = false; picking = true" />
        <UButton color="neutral" variant="ghost" label="Cancel" @click="adding = false" />
        <UButton type="submit" form="new-scene" :label="form.brief.trim() ? 'Create and build' : 'Create scene'" />
      </template>
    </UModal>
    <TemplatePickerModal v-model:open="picking" />
  </div>
</template>
