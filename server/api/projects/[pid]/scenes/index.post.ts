export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const { title = 'New scene', afterId } = await readBody<{ title?: string, afterId?: string }>(event)
  const id = newSceneId(title)
  const html = blankScene(title)
  await writeScene(p.id, id, html)
  await addVersion(p.id, id, html, 'Created')
  const i = afterId ? p.scenes.findIndex(s => s.id === afterId) : -1
  p.scenes.splice(i >= 0 ? i + 1 : p.scenes.length, 0, { id, title })
  await saveProject(p)
  return { id, project: await projectView(p.id) }
})
