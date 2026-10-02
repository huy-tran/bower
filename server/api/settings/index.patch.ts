import { patchSettings } from '../../utils/settings'

// Bower settings for this computer: the default chat model, defaults for new projects and keyboard shortcuts. The
// Claude Code location has its own route (settings/claude.put.ts) because it is checked before it is saved.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ model?: string | null, defaults?: Record<string, unknown>, hotkeys?: Record<string, string | null> }>(event)
  return patchSettings({
    ...(body.model !== undefined && { model: body.model }),
    ...(body.defaults && { defaults: body.defaults as any }),
    ...(body.hotkeys && { hotkeys: body.hotkeys as any })
  })
})
