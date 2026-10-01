<script setup lang="ts">
import type { ProjectView, SceneView, ScreenLayer } from '~/composables/useEditor'

const props = defineProps<{
  project: ProjectView
  // Scenes to keep loaded. Only the ones in `layers` are visible.
  scenes: SceneView[]
  layers: ScreenLayer[]
  caption?: string
  rounded?: boolean
  // Offer to have Claude fix a scene that throws.
  fixable?: boolean
  // Serve a specific saved version instead of the current file (side-by-side compare).
  version?: number
}>()

const chat = useChat()
const toast = useToast()
const box = ref<HTMLElement>()
const boxWidth = ref(0)
const frames = new Map<string, HTMLIFrameElement>()
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
    errors.delete(id)
    const l = props.layers.find(x => x.scene.id === id)
    if (l) post(id, l.t)
  }
  if (d.type === 'error') errors.set(id, d.message)
}

let ro: ResizeObserver | null = null
onMounted(() => {
  window.addEventListener('message', onMessage)
  ro = new ResizeObserver(([e]) => (boxWidth.value = e!.contentRect.width))
  if (box.value) ro.observe(box.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  ro?.disconnect()
})

watch(() => props.layers.map(l => `${l.scene.id}:${l.t}`).join('|'), () => {
  for (const l of props.layers) post(l.scene.id, l.t)
})

// A new file version reloads its iframe: forget its error.
watch(() => props.scenes.map(s => `${s.id}:${s.mtime}`).join(), () => {
  for (const s of props.scenes) {
    const f = frames.get(s.id)
    if (f && !f.src.endsWith(frameUrl(props.project.id, s, undefined, props.version))) errors.delete(s.id)
  }
})

const styleFor = (id: string) => {
  const l = props.layers.find(x => x.scene.id === id)
  if (!l) return { visibility: 'hidden' as const }
  return { visibility: 'visible' as const, opacity: l.opacity, transform: l.transform || undefined, clipPath: l.clip || undefined, filter: l.filter || undefined, zIndex: l.z }
}

const activeError = computed(() => {
  for (const l of [...props.layers].reverse()) {
    const e = errors.get(l.scene.id)
    if (e) return { scene: l.scene, message: e }
  }
  return null
})

const captionStyle = computed(() => {
  const c = props.project.captions
  const size = c.size * (boxWidth.value / props.project.width)
  return { fontSize: `${size}px`, ...(c.position === 'top' ? { top: '6%' } : { bottom: '7%' }) }
})

async function fix() {
  const e = activeError.value
  if (!e) return
  try {
    await chat.send(props.project.id, e.scene.id, `The preview of this scene throws an error: "${e.message}". Find the cause in ${e.scene.file} and fix it without changing how the scene looks or moves.`)
    toast.add({ title: `Claude is fixing ${e.scene.title}`, color: 'neutral' })
  } catch (err: any) {
    toast.add({ title: 'Could not start Claude', description: err?.data?.message, color: 'error' })
  }
}
</script>

<template>
  <div ref="box" class="relative size-full overflow-hidden bg-white" :class="rounded && 'rounded-md shadow-sm ring-1 ring-default'">
    <iframe
      v-for="s in scenes"
      :key="s.id"
      :ref="el => setFrame(s.id, el)"
      :src="frameUrl(project.id, s, undefined, version)"
      class="pointer-events-none absolute inset-0 size-full border-0"
      tabindex="-1"
      :style="styleFor(s.id)"
      :title="s.title"
    />
    <div v-if="caption && !activeError" class="pointer-events-none absolute inset-x-[6%] z-10 flex justify-center" :style="captionStyle">
      <span class="rounded-[0.35em] bg-black/70 px-[0.65em] py-[0.3em] text-center leading-snug font-semibold text-white">{{ caption }}</span>
    </div>
    <UAlert
      v-if="activeError"
      class="absolute inset-x-4 bottom-4 z-20 w-auto"
      color="error"
      variant="subtle"
      icon="i-heroicons-exclamation-triangle"
      :title="`${activeError.scene.title} threw an error`"
      :description="activeError.message"
      :ui="{ description: 'font-mono text-xs' }"
      @click.stop
      :actions="fixable && !chat.isBusy(project.id, activeError.scene.id) ? [{ label: 'Fix with Claude', icon: 'i-heroicons-wrench-screwdriver', color: 'error', variant: 'solid', size: 'xs', onClick: fix }] : undefined"
    />
  </div>
</template>
