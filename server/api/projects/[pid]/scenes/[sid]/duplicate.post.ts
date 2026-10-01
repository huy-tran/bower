export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  const i = p.scenes.findIndex(s => s.id === sid)
  if (i < 0) throw createError({ statusCode: 404, message: 'Scene not found' })
  const title = `${p.scenes[i]!.title} copy`
  const id = newSceneId(title)
  const html = await readScene(p.id, sid)
  await writeScene(p.id, id, html)
  await addVersion(p.id, id, html, `Duplicated from ${p.scenes[i]!.title}`)
  p.scenes.splice(i + 1, 0, { id, title })
  await saveProject(p)
  return { id, project: await projectView(p.id) }
})
