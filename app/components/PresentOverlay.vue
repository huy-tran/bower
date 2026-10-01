<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
const { project, active, setMode, seek, play, pause, toggle, playing, time, timelineDuration } = useEditor()
const root = ref<HTMLElement>()
const idle = ref(false)
let idleTimer: ReturnType<typeof setTimeout>

function wake() {
  idle.value = false
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => (idle.value = true), 1800)
}

function close() {
  pause()
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  if (e.key === ' ') { e.preventDefault(); toggle() }
}

function onFs() {
  if (!document.fullscreenElement) close()
}

onMounted(async () => {
  setMode('video')
  seek(0)
  await root.value?.requestFullscreen().catch(() => {})
  document.addEventListener('fullscreenchange', onFs)
  window.addEventListener('keydown', onKey)
  wake()
  setTimeout(play, 400)
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFs)
  window.removeEventListener('keydown', onKey)
  clearTimeout(idleTimer)
})
</script>

<template>
  <div ref="root" class="fixed inset-0 z-50 grid place-items-center bg-black" :class="idle && playing && 'cursor-none'" @mousemove="wake" @click="toggle">
    <div v-if="project && active" class="aspect-video w-full max-h-full max-w-[calc(100vh*16/9)]">
      <ScenePlayer :project="project" :scenes="project.scenes" :active-id="active.scene.id" :t="active.t" />
    </div>
    <div class="absolute inset-x-0 bottom-0 h-1 bg-white/10 transition-opacity" :class="idle && playing ? 'opacity-0' : 'opacity-100'">
      <div class="h-full bg-white/70" :style="{ width: `${timelineDuration ? time / timelineDuration * 100 : 0}%` }" />
    </div>
    <button class="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white transition-opacity hover:bg-white/20" :class="idle && playing ? 'opacity-0' : 'opacity-100'" @click.stop="close">
      <UIcon name="i-lucide-x" class="size-5" />
    </button>
  </div>
</template>
