// The scene's unsaved hand edits: save them as one version, discard them, or take back the latest one.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  if (!p.scenes.some(s => s.id === sid)) throw createError({ statusCode: 404, message: 'Scene not found' })
  const { action } = await readBody<{ action?: string }>(event)
  if (action === 'save') {
    if (getJob(p.id, sid)?.status === 'running' || getJob(p.id, 'project')?.status === 'running') {
      throw createError({ statusCode: 409, message: 'Claude is working on this scene. Save when it has finished.' })
    }
    await saveDraft(p.id, sid)
    // The voice clip and CLAUDE.md follow the scene (a new length moves the scenes after it).
    await saveProject(p)
  } else if (action === 'discard') {
    await removeDraft(p.id, sid)
  } else if (action === 'undo') {
    await undoDraft(p.id, sid)
  } else {
    throw createError({ statusCode: 422, message: 'Unknown action' })
  }
  return projectView(p.id)
})
