export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const { ids } = await readBody<{ ids: string[] }>(event)
  const byId = new Map(p.scenes.map(s => [s.id, s]))
  if (!Array.isArray(ids) || ids.length !== p.scenes.length || !ids.every(id => byId.has(id))) {
    throw createError({ statusCode: 422, message: 'Order must contain every scene exactly once' })
  }
  p.scenes = ids.map(id => byId.get(id)!)
  await saveProject(p)
  return projectView(p.id)
})
