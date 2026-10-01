export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const p = await loadProject(pid)
  const q = getQuery(event)
  const html = await buildPlayer(pid, { render: !!q.render, transparent: !!q.transparent })
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  if (q.download) setHeader(event, 'Content-Disposition', `attachment; filename="${slugify(p.name)}.html"`)
  return html
})
