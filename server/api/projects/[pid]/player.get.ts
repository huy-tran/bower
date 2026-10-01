export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const p = await loadProject(pid)
  const html = await buildPlayer(pid)
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  if (getQuery(event).download) setHeader(event, 'Content-Disposition', `attachment; filename="${slugify(p.name)}.html"`)
  return html
})
