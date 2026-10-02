import { claudeVersion, setClaudePath } from '../../utils/claudeBin'

// Point Bower at Claude Code on this machine (a folder or the program); an empty path goes back to automatic.
export default defineEventHandler(async (event) => {
  const { path } = await readBody<{ path?: string }>(event).catch(() => ({} as { path?: string }))
  const bin = await setClaudePath(String(path ?? ''))
  return { path: bin?.path ?? null, source: bin?.source ?? null, version: bin ? await claudeVersion(bin) : null }
})
