import { patchSettings } from '../../utils/settings'

// Bower settings for this computer: the default chat model and defaults for new projects. The Claude Code
// location has its own route (settings/claude.put.ts) because it is checked before it is saved.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ model?: string | null, defaults?: Record<string, unknown> }>(event)
  return patchSettings({ ...(body.model !== undefined && { model: body.model }), ...(body.defaults && { defaults: body.defaults as any }) })
})
