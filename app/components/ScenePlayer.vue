<script setup lang="ts">
import type { ProjectView, SceneView } from '~/composables/useEditor'

const props = defineProps<{
  project: ProjectView
  // Scenes to keep loaded. Only the active one is visible.
  scenes: SceneView[]
  activeId: string
  t: number
  rounded?: boolean
}>()

const frames = new Map<string, HTMLIFrameElement>()
const ready = reactive(new Set<string>())
const errors = reactive(new Map<string, string>())

function setFrame(id: string, el: unknown) {
  if (el) frames.set(id, el as HTMLIFrameElement)
  else frames.delete(id)
}

function post(id: string, t: number) {
  frames.get(id)?.contentWindow?.postMessage({ __ve: true, type: 'seek', t }, '*')
}

function onMessage(e: MessageEvent) {
  const d = e.data
  if (!d?.__ve) return
  const id = [...frames.entries()].find(([, f]) => f.contentWindow === e.source)?.[0]
  if (!id) return
  if (d.type === 'ready') {
    ready.add(id)
    errors.delete(id)
    if (id === props.activeId) post(id, props.t)
  }
  if (d.type === 'error') errors.set(id, d.message)
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

watch(() => [props.activeId, props.t] as const, ([id, t]) => post(id, t))

// A new file version reloads its iframe: forget its ready/error state.
watch(() => props.scenes.map(s => `${s.id}:${s.mtime}`).join(), () => {
  for (const s of props.scenes) {
    const f = frames.get(s.id)
    if (f && !f.src.endsWith(frameUrl(props.project.id, s))) {
      ready.delete(s.id)
      errors.delete(s.id)
    }
  }
})

const activeError = computed(() => errors.get(props.activeId))
</script>

<template>
  <div class="relative size-full overflow-hidden bg-white" :class="rounded && 'rounded-lg shadow-sm ring-1 ring-black/5'">
    <iframe
      v-for="s in scenes"
      :key="s.id"
      :ref="el => setFrame(s.id, el)"
      :src="frameUrl(project.id, s)"
      class="absolute inset-0 size-full border-0"
      :class="s.id === activeId ? 'visible' : 'invisible'"
      :title="s.title"
    />
    <div v-if="activeError" class="absolute inset-x-4 bottom-4 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
      <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
      <span class="font-mono text-xs leading-5">{{ activeError }}</span>
    </div>
  </div>
</template>
