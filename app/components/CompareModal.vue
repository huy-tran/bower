<script setup lang="ts">
import type { SceneView } from '~/composables/useEditor'

interface Version { n: number, at: string, label: string }

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ scene: SceneView }>()
const { project, setProject, pause: pauseEditor } = useEditor()
const toast = useToast()

const versions = ref<{ current: number, items: Version[] }>({ current: 0, items: [] })
const left = ref<number>()
const right = ref<number>()
const t = ref(0)
const playing = ref(false)
let raf = 0, last = 0

// Versions can have different lengths: play to the longer one, holding the shorter one's last frame.
const durations = reactive<Record<number, number>>({})
const duration = computed(() => Math.max(durations[left.value!] ?? props.scene.duration, durations[right.value!] ?? props.scene.duration))

watch(open, async (o) => {
  if (!o) { stop(); return }
  pauseEditor()
  versions.value = await $fetch(`/api/projects/${project.value!.id}/scenes/${props.scene.id}/versions`)
  const items = versions.value.items
  right.value = versions.value.current
  left.value = items[items.findIndex(v => v.n === versions.value.current) - 1]?.n ?? items[0]?.n
  t.value = 0
})

const items = computed(() => [...versions.value.items].reverse().map(v => ({
  label: `v${v.n}${v.n === versions.value.current ? ' (current)' : ''} · ${v.label}`,
  value: v.n
})))

const layer = (n?: number) => [{ index: 0, t: Math.min(t.value, durations[n!] ?? props.scene.duration), opacity: 1, transform: '', clip: '', filter: '', z: 1, scene: props.scene }]

function onMessage(e: MessageEvent) {
  if (e.data?.__ve && e.data.type === 'ready') {
    // Each side reports its own duration when it loads.
    const frames = [...document.querySelectorAll<HTMLIFrameElement>('[data-compare] iframe')]
    const i = frames.findIndex(f => f.contentWindow === e.source)
    const n = i === 0 ? left.value : i === 1 ? right.value : undefined
    if (n) durations[n] = e.data.duration
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => { window.removeEventListener('message', onMessage); stop() })

function tick(now: number) {
  if (!playing.value) return
  t.value += now - last
  last = now
  if (t.value >= duration.value) t.value = 0
  raf = requestAnimationFrame(tick)
}
function play() { playing.value = true; last = performance.now(); raf = requestAnimationFrame(tick) }
function stop() { playing.value = false; cancelAnimationFrame(raf) }

async function keep(n: number) {
  setProject(await $fetch(`/api/projects/${project.value!.id}/scenes/${props.scene.id}/versions/${n}/restore`, { method: 'POST' }))
  toast.add({ title: `Restored v${n}`, color: 'success' })
  open.value = false
}

const aspect = computed(() => `${project.value!.width} / ${project.value!.height}`)
</script>

<template>
  <UModal v-model:open="open" :title="`Compare versions · ${scene.title}`" description="Both sides play in sync." fullscreen>
    <template #body>
      <div v-if="project" class="flex h-full flex-col gap-4">
        <div class="grid min-h-0 flex-1 grid-cols-2 gap-4" data-compare>
          <div v-for="(side, i) in [left, right]" :key="i" class="flex min-h-0 flex-col gap-2">
            <USelect :model-value="side" :items="items" class="w-full" @update:model-value="v => i === 0 ? (left = Number(v)) : (right = Number(v))" />
            <div class="flex min-h-0 flex-1 items-center justify-center">
              <div class="w-full" :style="{ aspectRatio: aspect, maxHeight: '100%' }">
                <ScenePlayer v-if="side" :key="side" :project="project" :scenes="[scene]" :layers="layer(side)" :version="side" rounded />
              </div>
            </div>
            <UButton v-if="side && side !== versions.current" class="self-center" size="sm" color="neutral" variant="outline" icon="i-heroicons-check" :label="`Keep v${side}`" @click="keep(side)" />
            <UBadge v-else-if="side" class="self-center" color="neutral" variant="soft" label="Current version" />
          </div>
        </div>
        <div class="flex items-center gap-4">
          <UButton color="neutral" size="lg" class="rounded-full" :icon="playing ? 'i-heroicons-pause' : 'i-heroicons-play'" :aria-label="playing ? 'Pause' : 'Play'" @click="playing ? stop() : play()" />
          <span class="w-28 font-mono text-sm text-default tabular-nums">{{ (t / 1000).toFixed(2) }} <span class="text-dimmed">/ {{ fmtSeconds(duration) }}</span></span>
          <USlider :model-value="t" :min="0" :max="duration" :step="1" class="flex-1" @update:model-value="v => { stop(); t = Number(v) }" />
        </div>
      </div>
    </template>
  </UModal>
</template>
