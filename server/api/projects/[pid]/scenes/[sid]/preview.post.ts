// A scene frame built from unsaved source, for the code editor's live preview. Nothing is written.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  const sid = assertId(getRouterParam(event, 'sid'))
  const s = (await sceneViews(p)).find(x => x.id === sid)
  if (!s) throw createError({ statusCode: 404, message: 'Scene not found' })
  const { html } = await readBody<{ html?: string }>(event)
  if (typeof html !== 'string' || html.length > 2_000_000) throw createError({ statusCode: 422, message: 'Scene source is required' })
  s.duration = sceneMeta(html).duration
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return buildFrame(p, s, html)
})
