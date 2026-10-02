import { claudeVersion, findClaude, getClaudeSetting, spawnClaude } from '../utils/claudeBin'

interface Health { claude: { installed: boolean, loggedIn: boolean, method?: string, version?: string, path?: string, source?: string, setting: string } }

let cached: { at: number, value: Health } | null = null

// Tells a new teammate up front if Claude Code is missing or signed out, and where Bower found it.
export default defineEventHandler(async (event) => {
  // ?fresh=1 skips the cache, for the setup checklist's "Check again" after installing or signing in.
  const fresh = !!getQuery(event).fresh
  const bin = await findClaude(fresh)
  // The cached answer is only good for the same Claude Code: a new location (chosen in the checklist) re-checks.
  if (cached && !fresh && Date.now() - cached.at < 60_000 && cached.value.claude.path === bin?.path) return cached.value
  const version = bin ? await claudeVersion(bin) : null
  const value: Health = { claude: { installed: !!version, loggedIn: false, path: bin?.path, source: bin?.source, setting: await getClaudeSetting() } }
  if (bin && version) {
    value.claude.version = version
    const status = await new Promise<string>((resolve) => {
      let out = ''
      const p = spawnClaude(bin, ['auth', 'status'], {})
      p.stdout?.on('data', d => (out += d))
      p.on('error', () => resolve(out))
      p.on('close', () => resolve(out))
      setTimeout(() => { p.kill(); resolve(out) }, 15000)
    })
    try {
      const s = JSON.parse(status)
      value.claude.loggedIn = !!s.loggedIn
      value.claude.method = s.authMethod
    } catch {
      // Older CLIs have no `auth status`; assume the login is fine and let chat errors explain otherwise.
      value.claude.loggedIn = true
    }
  }
  cached = { at: Date.now(), value }
  return value
})
