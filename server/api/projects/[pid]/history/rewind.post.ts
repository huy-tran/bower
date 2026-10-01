// Rewind every scene to how it was at a moment in the project's history.
export default defineEventHandler(async (event) => {
  const { at } = await readBody<{ at?: string }>(event)
  if (!at || Number.isNaN(Date.parse(at))) throw createError({ statusCode: 422, message: 'Give a moment to rewind to' })
  return rewindProject(getRouterParam(event, 'pid')!, new Date(at).toISOString())
})
