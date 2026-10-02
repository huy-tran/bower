<script setup lang="ts">
// What a new project needs, in plain words, with a button to fix each item. Only Claude Code is required; the
// rest makes videos look like the real product. Shown at the top of Settings, General.
import type { SettingsTab } from './ProjectSettingsModal.vue'

const props = defineProps<{ session: { signedIn?: boolean, reachable?: boolean, saved: { user: string } | null } | null }>()
const emit = defineEmits<{ go: [tab: SettingsTab], test: [] }>()
const { project } = useEditor()

const health = ref<{ claude: { installed: boolean, loggedIn: boolean } } | null>(null)
const checking = ref(false)
async function checkClaude(fresh = false) {
  checking.value = true
  health.value = await $fetch<any>(`/api/health${fresh ? '?fresh=1' : ''}`).catch(() => null)
  checking.value = false
}
onMounted(() => checkClaude())

interface Item { key: string, label: string, detail: string, done: boolean, optional?: boolean, action?: { label: string, onClick: () => void }, href?: string }
const items = computed<Item[]>(() => {
  const p = project.value
  const c = health.value?.claude
  const s = props.session
  const list: Item[] = [
    {
      key: 'claude',
      label: 'Claude Code is installed and signed in',
      detail: !c ? 'Checking…' : !c.installed ? 'Bower uses Claude Code to build scenes. Install it, open it once and sign in, then check again.' : !c.loggedIn ? 'Open Claude Code once and sign in with your Claude account, then check again.' : 'Ready.',
      done: !!c?.installed && !!c?.loggedIn,
      action: { label: checking.value ? 'Checking…' : 'Check again', onClick: () => checkClaude(true) },
      href: c && !c.installed ? 'https://claude.com/claude-code' : undefined
    },
    { key: 'app', label: 'Your app’s address is set', detail: p?.app ? p.app.url : 'So Claude can show real screens of your product. Skip it if the video is not about an app.', done: !!p?.app, optional: true, action: { label: 'Set address', onClick: () => emit('go', 'app') } }
  ]
  if (p?.app) {
    list.push(
      { key: 'reach', label: 'Bower can reach the app', detail: s?.reachable === false ? 'The last test could not reach it. Is the site running?' : s?.reachable ? 'The last test reached it.' : 'Not tested yet.', done: !!s?.reachable, optional: true, action: { label: 'Test connection', onClick: () => emit('test') } },
      { key: 'signin', label: 'Bower is signed in to the app', detail: s?.saved ? `A saved login (${s.saved.user}) signs in when needed.` : s?.signedIn ? 'Signed in.' : s?.signedIn === false ? 'Signed out. Sign in again, or save a login.' : 'Sign in once if the app needs it.', done: !!s?.signedIn || !!s?.saved, optional: true, action: { label: 'Sign in', onClick: () => emit('go', 'app') } }
    )
  }
  list.push(
    { key: 'code', label: 'The app’s code is linked', detail: p?.codebases.length ? p.codebases.map(c => c.label).join(', ') : 'Helps Claude match real colours, copy and components. A developer can set this up for you.', done: !!p?.codebases.length, optional: true, action: { label: 'Link code', onClick: () => emit('go', 'codebase') } },
    { key: 'brand', label: 'A brand kit is chosen', detail: p?.brandKitId ? 'Claude follows its colours, fonts and logos.' : 'Colours, fonts and logos to stay on brand.', done: !!p?.brandKitId, optional: true, action: { label: 'Choose kit', onClick: () => emit('go', 'brand') } }
  )
  return list
})
const doneCount = computed(() => items.value.filter(i => i.done).length)
const open = ref(true)
watch(doneCount, (n) => { if (n === items.value.length) open.value = false }, { immediate: true })
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-4' }">
    <button type="button" class="flex w-full items-center gap-3 text-left" @click="open = !open">
      <UIcon :name="doneCount === items.length ? 'i-heroicons-check-badge' : 'i-heroicons-rocket-launch'" class="size-5 shrink-0" :class="doneCount === items.length ? 'text-success' : 'text-primary'" />
      <div class="min-w-0 flex-1">
        <h3 class="font-semibold text-highlighted">{{ doneCount === items.length ? 'All set up' : 'Set up this project' }}</h3>
        <p class="text-xs text-muted">{{ doneCount }} of {{ items.length }} done. Only Claude Code is required; the rest makes the video look like your real product.</p>
      </div>
      <UIcon :name="open ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="size-4 text-muted" />
    </button>
    <ul v-if="open" class="mt-4 space-y-3">
      <li v-for="i in items" :key="i.key" class="flex items-start gap-3">
        <UIcon :name="i.done ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'" class="mt-0.5 size-5 shrink-0" :class="i.done ? 'text-success' : i.optional ? 'text-dimmed' : 'text-warning'" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium" :class="i.done ? 'text-muted' : 'text-highlighted'">{{ i.label }}<span v-if="i.optional && !i.done" class="ml-1.5 text-xs font-normal text-dimmed">optional</span></p>
          <p class="truncate text-xs text-muted" :title="i.detail">{{ i.detail }}</p>
        </div>
        <UButton v-if="i.href" size="xs" color="primary" variant="soft" label="Get Claude Code" trailing-icon="i-heroicons-arrow-top-right-on-square" :to="i.href" target="_blank" />
        <UButton v-if="i.action && !(i.done && i.key !== 'reach')" size="xs" color="neutral" variant="outline" :label="i.action.label" :loading="i.key === 'claude' && checking" @click="i.action.onClick" />
      </li>
    </ul>
  </UCard>
</template>
