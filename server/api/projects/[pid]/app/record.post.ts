// Open a visible window that records the user's clicks and typing as capture steps.
export default defineEventHandler(async (event) => {
  const { target } = await readBody<{ target?: string }>(event).catch(() => ({} as { target?: string }))
  return startRecording(getRouterParam(event, 'pid')!, typeof target === 'string' ? target : undefined)
})
