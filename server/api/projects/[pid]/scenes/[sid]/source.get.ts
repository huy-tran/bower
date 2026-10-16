// The scene as the editor shows it (its unsaved hand edits, else the saved file), with what can be changed by
// hand: its text and its animation timings. `hash` goes back with each edit so one made against an older source
// is refused.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  if (!p.scenes.some(s => s.id === sid)) throw createError({ statusCode: 404, message: 'Scene not found' })
  const source = await editableSource(p.id, sid)
  const { timings, computed } = findTimings(source)
  return { source, hash: sourceHash(source), texts: textElements(source), timings, computed, tracks: sceneMeta(source).tracks, elements: elementStarts(source) }
})
