// Insert a template into this project after the given scene (or at the end).
export default defineEventHandler(async (event) => {
  const { afterId } = await readBody<{ afterId?: string }>(event).catch(() => ({} as { afterId?: string }))
  return insertTemplate(getRouterParam(event, 'pid')!, getRouterParam(event, 'id')!, typeof afterId === 'string' ? afterId : undefined)
})
