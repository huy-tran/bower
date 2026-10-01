export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  if (p.scenes.length <= 1) throw createError({ statusCode: 422, message: 'A project needs at least one scene' })
  p.scenes = p.scenes.filter(s => s.id !== sid)
  await saveProject(p)
  await removeSceneData(p.id, sid)
  return projectView(p.id)
})
