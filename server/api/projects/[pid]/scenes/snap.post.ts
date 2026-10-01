// Snap every cut to the nearest beat grid mark by adjusting scene durations.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const vb = videoBeats(p)
  if (!vb?.downbeats.length) throw createError({ statusCode: 422, message: 'Analyse a music track first' })
  const body = await readBody<{ grid?: 'beats' | 'downbeats' | 'phrases' }>(event).catch(() => null)
  const grid = body?.grid ?? 'downbeats'
  const marks = vb[grid]?.length ? vb[grid] : vb.downbeats
  const views = await sceneViews(p)
  let prevCut = 0
  for (const s of views) {
    const end = s.start + s.duration
    const candidates = marks.filter(m => m > prevCut + 250)
    const cut = candidates.length ? candidates.reduce((a, b) => Math.abs(b - end) < Math.abs(a - end) ? b : a) : end
    const duration = Math.round(cut - prevCut)
    if (duration !== s.duration) {
      const html = withDuration(await readScene(p.id, s.id), duration)
      await writeScene(p.id, s.id, html)
      await addVersion(p.id, s.id, html, `Snapped to ${grid}`)
    }
    prevCut = cut
  }
  return projectView(p.id)
})
