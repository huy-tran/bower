import { spawn } from 'node:child_process'

interface Health { claude: { installed: boolean, loggedIn: boolean, method?: string, version?: string } }

let cached: { at: number, value: Health } | null = null

function run(args: string[]) {
  return new Promise<{ ok: boolean, out: string }>((resolve) => {
    let out = ''
    const p = spawn(process.env.CLAUDE_BIN || 'claude', args, { windowsHide: true })
    p.stdout.on('data', d => (out += d))
    p.on('error', () => resolve({ ok: false, out }))
    p.on('close', () => resolve({ ok: true, out }))
    setTimeout(() => { p.kill(); resolve({ ok: false, out }) }, 15000)
  })
}

// Tells a new teammate up front if Claude Code is missing or signed out.
export default defineEventHandler(async (event) => {
  // ?fresh=1 skips the cache, for the setup checklist's "Check again" after installing or signing in.
  if (cached && !getQuery(event).fresh && Date.now() - cached.at < 60_000) return cached.value
  const version = await run(['--version'])
  const value: Health = { claude: { installed: version.ok && !!version.out.trim(), loggedIn: false } }
  if (value.claude.installed) {
    value.claude.version = version.out.trim().split(/\s/)[0]
    const status = await run(['auth', 'status'])
    try {
      const s = JSON.parse(status.out)
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
