// The scene file as it is now, with what the editor can change by hand: its text and its animation timings.
// `hash` goes back with each edit so one made against an older file is refused.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  if (!p.scenes.some(s => s.id === sid)) throw createError({ statusCode: 404, message: 'Scene not found' })
  const source = await readScene(p.id, sid)
  const { timings, computed } = findTimings(source)
  return { source, hash: sourceHash(source), texts: textElements(source), timings, computed }
})
