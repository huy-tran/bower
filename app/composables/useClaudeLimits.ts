// How much of the Claude plan's limits is used (the 5-hour and weekly windows), for the header meter. Claude Code
// reports it with every run, so the figures are as of the last run on this computer. Crossing 80% or 95% of a
// window, or hitting a limit, shows a toast once per window.
export interface LimitWindow { utilization: number, resetsAt: number }
export interface ClaudeLimits { status: string, windows: Record<string, LimitWindow>, isUsingOverage: boolean, at: string }

export const WINDOW_LABELS: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit', seven_day_opus: 'Weekly Opus limit', seven_day_sonnet: 'Weekly Sonnet limit' }
const ALERTS = [0.8, 0.95]
const POLL_MS = 30_000

const limits = ref<ClaudeLimits | null>(null)
const now = ref(Date.now())
let started = false

// A window that has since reset counts as unused until the next run says otherwise.
function used(w: LimitWindow) {
  return w.resetsAt && w.resetsAt * 1000 < now.value ? 0 : w.utilization
}

export function resetTime(w: LimitWindow) {
  if (!w.resetsAt) return ''
  const d = new Date(w.resetsAt * 1000)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function useClaudeLimits() {
  const toast = useToast()

  const windows = computed(() => Object.entries(limits.value?.windows ?? {})
    .map(([name, w]) => ({ name, label: WINDOW_LABELS[name] ?? name.replace(/_/g, ' '), used: used(w), resets: resetTime(w), window: w }))
    .sort((a, b) => (a.name === 'five_hour' ? -1 : b.name === 'five_hour' ? 1 : a.name.localeCompare(b.name))))
  const highest = computed(() => windows.value.reduce((m, w) => Math.max(m, w.used), 0))
  const blocked = computed(() => limits.value?.status === 'rejected' && highest.value >= 1)
  const color = computed(() => blocked.value || highest.value >= 0.95 ? 'error' as const : highest.value >= 0.8 ? 'warning' as const : 'neutral' as const)

  // Each alert shows once per window period, remembered across reloads.
  function seen(key: string) {
    try {
      const list: string[] = JSON.parse(localStorage.getItem('bower:limit-alerts') || '[]')
      if (list.includes(key)) return true
      localStorage.setItem('bower:limit-alerts', JSON.stringify([...list, key].slice(-30)))
    } catch {}
    return false
  }
  function alert() {
    for (const w of windows.value) {
      const hit = [...ALERTS, 1].filter(t => w.used >= t).at(-1)
      if (!hit || seen(`${w.name}:${w.window.resetsAt}:${hit}`)) continue
      toast.add(hit >= 1
        ? { title: `Claude ${w.label.toLowerCase()} reached`, description: `Claude cannot work until it resets${w.resets ? ` at ${w.resets}` : ''}.`, color: 'error', icon: 'i-heroicons-exclamation-triangle', duration: 0 }
        : { title: `${Math.round(w.used * 100)}% of the Claude ${w.label.toLowerCase()} used`, description: `It resets${w.resets ? ` at ${w.resets}` : ' soon'}. Smaller requests, or Sonnet or Haiku for this project, go further.`, color: hit >= 0.95 ? 'error' : 'warning', icon: 'i-heroicons-exclamation-triangle' })
    }
  }

  async function refresh() {
    now.value = Date.now()
    const next = await $fetch<ClaudeLimits | null>('/api/claude/limits').catch(() => undefined)
    if (next === undefined || next?.at === limits.value?.at) return
    limits.value = next
    alert()
  }

  if (import.meta.client && !started) {
    started = true
    refresh()
    setInterval(() => { if (document.visibilityState === 'visible') refresh() }, POLL_MS)
  }

  return { limits, windows, highest, blocked, color, refresh }
}
