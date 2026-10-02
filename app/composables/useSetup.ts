// Project setup progress, shared by the checklist in Settings, General and the "Setup 3/5" chip in the header,
// so both always agree. Claude Code is not a project item (it is set up in Bower settings) but it is checked
// here too: when it is not ready, the chip warns about it instead.
import type { SettingsTab } from '~/components/ProjectSettingsModal.vue'

export interface ClaudeHealth { installed: boolean, loggedIn: boolean, version?: string, path?: string, source?: string, setting: string }
export interface SetupSession { signedIn?: boolean, reachable?: boolean, saved: { user: string } | null }
export interface SetupItem { key: string, label: string, detail: string, done: boolean, optional?: boolean, tab?: SettingsTab, action?: string }

const health = ref<ClaudeHealth | null>(null)
const checkingClaude = ref(false)
const session = ref<SetupSession | null>(null)
const sessionFor = ref('')

async function checkClaude(fresh = false) {
  checkingClaude.value = true
  try {
    health.value = (await $fetch<{ claude: ClaudeHealth }>(`/api/health${fresh ? '?fresh=1' : ''}`)).claude
  } catch {
    health.value = null
  } finally {
    checkingClaude.value = false
  }
}

async function loadSession(pid: string, hasApp: boolean) {
  sessionFor.value = pid
  session.value = hasApp ? await $fetch<SetupSession>(`/api/projects/${pid}/app/session`).catch(() => null) : null
}

export function useSetup() {
  const { project } = useEditor()

  const items = computed<SetupItem[]>(() => {
    const p = project.value
    const s = sessionFor.value === p?.id ? session.value : null
    const list: SetupItem[] = [{ key: 'app', label: 'The app is chosen', detail: p?.app ? `${p.app.name} (${p.app.url})` : 'So Claude can show real screens of your product. Skip it if the video is not about an app.', done: !!p?.app, optional: true, tab: 'app', action: 'Choose app' }]
    if (p?.app) {
      list.push(
        { key: 'reach', label: 'Bower can reach the app', detail: s?.reachable === false ? 'The last test could not reach it. Is the site running?' : s?.reachable ? 'The last test reached it.' : 'Not tested yet.', done: !!s?.reachable, optional: true, tab: 'app', action: 'Test connection' },
        { key: 'signin', label: 'Bower is signed in to the app', detail: s?.saved ? `A saved login (${s.saved.user}) signs in when needed.` : s?.signedIn ? 'Signed in.' : s?.signedIn === false ? 'Signed out. Sign in again, or save a login.' : 'Sign in once if the app needs it.', done: !!s?.signedIn || !!s?.saved, optional: true, tab: 'app', action: 'Sign in' }
      )
    }
    list.push(
      { key: 'code', label: 'The app’s code is linked', detail: [...(p?.appCodebases ?? []), ...(p?.codebases ?? [])].map(x => x.label).join(', ') || 'Helps Claude match real colours, copy and components. A developer can set this up for you.', done: !!(p?.appCodebases?.length || p?.codebases.length), optional: true, tab: 'codebase', action: 'Link code' },
      { key: 'brand', label: 'A brand kit is chosen', detail: p?.brandKitId ? 'Claude follows its colours, fonts and logos.' : 'Colours, fonts and logos to stay on brand.', done: !!p?.brandKitId, optional: true, tab: 'brand', action: 'Choose kit' }
    )
    return list
  })
  const done = computed(() => items.value.filter(i => i.done).length)
  const total = computed(() => items.value.length)
  // Claude Code missing or signed out blocks everything, so the chip turns to a warning.
  const blocked = computed(() => !!health.value && !(health.value.installed && health.value.loggedIn))

  return {
    items, done, total, blocked, health: readonly(health), checkingClaude: readonly(checkingClaude),
    checkClaude, loadSession, setSession: (pid: string, s: SetupSession | null) => { sessionFor.value = pid; session.value = s }
  }
}
