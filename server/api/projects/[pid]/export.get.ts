export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const p = await loadProject(pid)
  const zip = await exportBundle(pid)
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="${slugify(p.name)}.storyboard.zip"`)
  setHeader(event, 'Content-Length', zip.byteLength)
  return Buffer.from(zip)
})
