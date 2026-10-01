export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  const s = p.scenes.find(x => x.id === sid)
  if (!s) throw createError({ statusCode: 404, message: 'Scene not found' })
  const body = await readBody<{ title?: string, duration?: number, transition?: Transition | null }>(event)
  if (body.title?.trim()) s.title = body.title.trim()
  if (body.duration && body.duration >= 100) {
    const html = withDuration(await readScene(p.id, sid), body.duration)
    await writeScene(p.id, sid, html)
    await addVersion(p.id, sid, html, `Duration ${(body.duration / 1000).toFixed(2)}s`)
  }
  // The transition into this scene from the previous one.
  if (body.transition !== undefined) {
    const t = body.transition
    s.transition = t && TRANSITIONS.some(x => x.value === t.type) && t.type !== 'cut'
      ? { type: t.type, duration: Math.min(3000, Math.max(100, Math.round(Number(t.duration) || 600))) }
      : null
  }
  await saveProject(p)
  return projectView(p.id)
})
