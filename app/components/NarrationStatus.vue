<script setup lang="ts">
// Header chip for generated narration: what is happening now, and a per-scene list of the current or last batch.
const narration = useNarration()
const { state, counts } = narration
const { seek, setMode, pause, project } = useEditor()

const visible = computed(() => !!state.busy || state.batch.length > 0)
const label = computed(() => {
  const c = counts.value
  if (state.busy) {
    const n = state.batch.findIndex(b => b.id === state.busy) + 1
    const pct = state.pct ? ` ${Math.round(state.pct)}%` : ''
    return `Narrating ${n}/${c.total} · ${state.title}${pct}`
  }
  if (c.failed && !c.done) return `Narration failed · ${c.failed}`
  if (c.failed) return `Narrated ${c.done}/${c.total} · ${c.failed} failed`
  return `Narration ready · ${c.done} scene${c.done > 1 ? 's' : ''}`
})
const color = computed(() => state.busy ? 'info' : counts.value.failed ? 'warning' : 'success')
const icon = computed(() => state.busy ? 'i-heroicons-arrow-path' : counts.value.failed ? 'i-heroicons-exclamation-triangle' : 'i-heroicons-check-circle')

const rows = computed(() => state.batch.map(b => ({ ...b, status: state.status.get(b.id) ?? { state: 'queued' as const } })))

function goTo(id: string) {
  const s = project.value?.scenes.find(x => x.id === id)
  if (!s) return
  pause()
  setMode('video')
  seek(s.start)
}
</script>

<template>
  <UPopover v-if="visible" :content="{ align: 'end' }">
    <UButton :color="color" variant="subtle" size="sm" :icon="icon" :label="label" :ui="{ leadingIcon: state.busy ? 'animate-spin' : '' }" />
    <template #content>
      <div class="w-96 p-3">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm font-semibold text-highlighted">{{ state.busy ? 'Generating narration' : 'Narration' }}</p>
          <UButton v-if="!state.busy" size="xs" color="neutral" variant="ghost" icon="i-heroicons-x-mark" aria-label="Dismiss" @click="narration.dismiss()" />
        </div>
        <p v-if="state.busy" class="mb-2 text-xs text-muted">{{ state.label }}{{ state.pct ? ` · ${Math.round(state.pct)}%` : '' }}</p>
        <UProgress v-if="state.busy" :model-value="state.pct ?? null" size="xs" class="mb-3" />
        <ul class="max-h-72 divide-y divide-default overflow-y-auto">
          <li v-for="r in rows" :key="r.id" class="flex items-center gap-2 py-1.5 text-sm">
            <UIcon
              :name="r.status.state === 'done' ? 'i-heroicons-check-circle' : r.status.state === 'failed' ? 'i-heroicons-x-circle' : r.status.state === 'generating' ? 'i-heroicons-arrow-path' : 'i-heroicons-clock'"
              class="size-4 shrink-0"
              :class="{ 'text-success': r.status.state === 'done', 'text-error': r.status.state === 'failed', 'text-info animate-spin': r.status.state === 'generating', 'text-dimmed': r.status.state === 'queued' }"
            />
            <button class="min-w-0 flex-1 truncate text-left hover:underline" @click="goTo(r.id)">{{ r.title }}</button>
            <span class="shrink-0 text-xs text-muted">
              <template v-if="r.status.state === 'done'">{{ fmtSeconds(r.status.durationMs, 1) }}<span v-if="r.status.overBy > 50" class="text-warning"> · {{ fmtSeconds(r.status.overBy, 1) }} over</span></template>
              <template v-else-if="r.status.state === 'generating'">{{ r.status.label }}{{ r.status.pct ? ` ${Math.round(r.status.pct)}%` : '' }}</template>
              <template v-else-if="r.status.state === 'failed'"><span class="text-error">{{ r.status.error }}</span></template>
              <template v-else>Queued</template>
            </span>
          </li>
        </ul>
        <div v-if="!state.busy && counts.failed" class="mt-2 flex justify-end">
          <UButton size="xs" color="neutral" variant="outline" icon="i-heroicons-arrow-path" label="Retry failed" @click="narration.retry()" />
        </div>
      </div>
    </template>
  </UPopover>
</template>
