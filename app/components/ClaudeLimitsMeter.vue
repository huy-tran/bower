<script setup lang="ts">
// Header meter for the Claude plan's limits: the fullest window at a glance, every window in the popover.
// Hidden until Claude has run once on this computer, and for API-key logins, which have no plan limits.
const { limits, windows, highest, blocked, color } = useClaudeLimits()

const pct = (v: number) => `${Math.round(v * 100)}%`
const asOf = computed(() => limits.value ? new Date(limits.value.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')
</script>

<template>
  <UPopover v-if="windows.length" :content="{ align: 'end' }">
    <UButton :color="color" :variant="color === 'neutral' ? 'ghost' : 'soft'" :aria-label="`Claude plan usage ${pct(highest)}`">
      <template #leading>
        <UIcon v-if="blocked" name="i-heroicons-exclamation-triangle" class="size-5" />
        <svg v-else class="size-5 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2.5" />
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" :stroke-dasharray="`${Math.min(1, highest) * 47.12} 47.12`" />
        </svg>
      </template>
      {{ blocked ? 'Claude limit reached' : `Claude ${pct(highest)}` }}
    </UButton>
    <template #content>
      <div class="w-80 space-y-4 p-4">
        <div>
          <p class="text-sm font-semibold text-highlighted">Claude plan usage</p>
          <p class="text-xs text-muted">Shared with everything else on your Claude account, like claude.ai and Claude Code in a terminal.</p>
        </div>
        <div v-for="w in windows" :key="w.name" class="space-y-1.5">
          <div class="flex items-baseline justify-between gap-3 text-sm">
            <span class="font-medium text-default">{{ w.label }}</span>
            <span class="font-mono text-xs" :class="w.used >= 0.95 ? 'text-error' : w.used >= 0.8 ? 'text-warning' : 'text-muted'">{{ pct(w.used) }}</span>
          </div>
          <UProgress :model-value="Math.min(100, w.used * 100)" size="sm" :color="w.used >= 0.95 ? 'error' : w.used >= 0.8 ? 'warning' : 'primary'" />
          <p v-if="w.resets" class="text-xs text-muted">Resets {{ w.resets }}</p>
        </div>
        <p v-if="limits?.isUsingOverage" class="text-xs text-warning">Using extra usage beyond the plan.</p>
        <p class="border-t border-default pt-3 text-xs text-dimmed">As of the last Claude run in Bower, {{ asOf }}. Use elsewhere shows after the next run.</p>
      </div>
    </template>
  </UPopover>
</template>
