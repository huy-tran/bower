export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name?: string }>(event).catch(() => ({ name: undefined }))
  const p = await duplicateProject(assertId(getRouterParam(event, 'pid')), { name })
  return { id: p.id, name: p.name }
})
