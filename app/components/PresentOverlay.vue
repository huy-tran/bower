<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
const { project, active, layers, caption, setMode, setLoop, setRate, seek, play, pause, toggle, playing, time, timelineDuration } = useEditor()
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
  setLoop(null)
  setRate(1)
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
    <div v-if="project && active" class="max-h-full w-full" :style="{ aspectRatio: `${project.width} / ${project.height}`, maxWidth: `calc(100vh * ${project.width} / ${project.height})` }">
      <ScenePlayer :project="project" :scenes="project.scenes" :layers="layers" :caption="caption" />
    </div>
    <div class="absolute inset-x-0 bottom-0 h-1 bg-white/10 transition-opacity" :class="idle && playing ? 'opacity-0' : 'opacity-100'">
      <div class="h-full bg-white/70" :style="{ width: `${timelineDuration ? time / timelineDuration * 100 : 0}%` }" />
    </div>
    <UButton
      class="absolute top-4 right-4 rounded-full transition-opacity"
      :class="idle && playing ? 'opacity-0' : 'opacity-100'"
      color="neutral"
      variant="soft"
      size="lg"
      icon="i-heroicons-x-mark"
      aria-label="Exit presentation"
      @click.stop="close"
    />
  </div>
</template>
