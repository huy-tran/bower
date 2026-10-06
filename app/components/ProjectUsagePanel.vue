<script setup lang="ts">
// Project settings, Usage: the tokens and cost of every Claude run in this project, by kind of work and by model.
interface Totals { runs: number, costUsd: number, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }
interface Run extends Totals { at: string, kind: Kind, models: string[], ok: boolean }
type Kind = 'chat' | 'storyboard' | 'scan' | 'notes'
interface Usage { since: string, total: Totals, byKind: Partial<Record<Kind, Totals>>, byModel: Record<string, Totals>, recent: Run[] }

const { project } = useEditor()
const toast = useToast()
const usage = ref<Usage | null>(null)
const confirming = ref(false)

const KINDS: Record<Kind, string> = { chat: 'Chat edits', storyboard: 'Storyboards', scan: 'Codebase scans', notes: 'App notes' }

async function load() {
  usage.value = await $fetch<Usage>(`/api/projects/${project.value!.id}/usage`).catch(() => null)
}
watch(() => project.value?.id, load, { immediate: true })

async function reset() {
  try {
    usage.value = await $fetch<Usage>(`/api/projects/${project.value!.id}/usage`, { method: 'DELETE' })
    toast.add({ title: 'Usage reset', description: 'Counting starts again from now.', color: 'neutral' })
  } catch (e: any) {
    toast.add({ title: 'Could not reset usage', description: e?.data?.message || e?.message, color: 'error' })
  } finally {
    confirming.value = false
  }
}

const usd = (v: number) => v < 0.01 && v > 0 ? '<$0.01' : `$${v.toFixed(2)}`
const tokens = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v)
const allTokens = (t: Totals) => t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
// "claude-sonnet-4-5" -> "Sonnet 4.5"
const modelLabel = (id: string) => {
  const m = id.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id
}
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

const kinds = computed(() => (Object.entries(usage.value?.byKind ?? {}) as [Kind, Totals][]).sort((a, b) => b[1].costUsd - a[1].costUsd))
const models = computed(() => Object.entries(usage.value?.byModel ?? {}).sort((a, b) => b[1].costUsd - a[1].costUsd))
</script>

<template>
  <div v-if="usage" class="space-y-6">
    <div class="grid grid-cols-3 gap-3">
      <div class="rounded-lg p-4 ring-1 ring-default">
        <p class="text-xs text-muted">Cost at API prices</p>
        <p class="mt-1 text-2xl font-semibold text-highlighted">{{ usd(usage.total.costUsd) }}</p>
      </div>
      <div class="rounded-lg p-4 ring-1 ring-default">
        <p class="text-xs text-muted">Tokens</p>
        <p class="mt-1 text-2xl font-semibold text-highlighted">{{ tokens(allTokens(usage.total)) }}</p>
        <p class="text-xs text-muted">{{ tokens(usage.total.outputTokens) }} written by Claude</p>
      </div>
      <div class="rounded-lg p-4 ring-1 ring-default">
        <p class="text-xs text-muted">Claude runs</p>
        <p class="mt-1 text-2xl font-semibold text-highlighted">{{ usage.total.runs }}</p>
      </div>
    </div>
    <p class="text-xs text-muted">
      <template v-if="usage.total.runs">Since {{ when(usage.since) }}. </template>On a Claude subscription this is what the same work would cost through the API, not
      a charge: it shows which work is heavy. Your plan's limits are in the meter at the top of the window.
    </p>

    <UEmpty v-if="!usage.total.runs" variant="soft" icon="i-heroicons-chart-bar" title="No Claude runs yet" description="Chats, storyboards, codebase scans and app notes are counted here from now on." />

    <template v-else>
      <div class="grid grid-cols-2 gap-6">
        <div>
          <h3 class="mb-2 text-sm font-semibold text-highlighted">By kind of work</h3>
          <div class="divide-y divide-default rounded-lg ring-1 ring-default">
            <div v-for="[k, t] in kinds" :key="k" class="flex items-center gap-3 px-3 py-2 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ KINDS[k] ?? k }}</span>
              <span class="text-xs text-muted">{{ t.runs }} {{ t.runs === 1 ? 'run' : 'runs' }}</span>
              <span class="w-16 text-right font-mono text-xs">{{ usd(t.costUsd) }}</span>
            </div>
          </div>
        </div>
        <div>
          <h3 class="mb-2 text-sm font-semibold text-highlighted">By model</h3>
          <div class="divide-y divide-default rounded-lg ring-1 ring-default">
            <div v-for="[m, t] in models" :key="m" class="flex items-center gap-3 px-3 py-2 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ modelLabel(m) }}</span>
              <span class="text-xs text-muted">{{ tokens(allTokens(t)) }} tokens</span>
              <span class="w-16 text-right font-mono text-xs">{{ usd(t.costUsd) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 class="mb-2 text-sm font-semibold text-highlighted">Recent runs</h3>
        <div class="divide-y divide-default rounded-lg ring-1 ring-default">
          <div v-for="r in usage.recent.slice(0, 15)" :key="r.at + r.kind" class="flex items-center gap-3 px-3 py-2 text-sm">
            <UIcon :name="r.ok ? 'i-heroicons-check-circle' : 'i-heroicons-x-circle'" class="size-4 shrink-0" :class="r.ok ? 'text-success' : 'text-error'" />
            <span class="w-28 shrink-0">{{ KINDS[r.kind] ?? r.kind }}</span>
            <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ r.models.map(modelLabel).join(', ') }} · {{ when(r.at) }}</span>
            <span class="text-xs text-muted">{{ tokens(allTokens(r)) }}</span>
            <span class="w-16 text-right font-mono text-xs">{{ usd(r.costUsd) }}</span>
          </div>
        </div>
      </div>
    </template>

    <div class="flex justify-end">
      <UButton color="neutral" variant="outline" icon="i-heroicons-arrow-path" label="Reset" :disabled="!usage.total.runs" @click="confirming = true" />
    </div>
    <UModal :open="confirming" title="Reset usage for this project?" description="The totals and recent runs start again from zero, for example after invoicing the work so far." @update:open="v => (confirming = v)">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirming = false" />
          <UButton color="error" label="Reset" @click="reset" />
        </div>
      </template>
    </UModal>
  </div>
</template>
