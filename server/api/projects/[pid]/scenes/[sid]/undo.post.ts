export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const sid = assertId(getRouterParam(event, 'sid'))
  const idx = await getVersions(pid, sid)
  const i = idx.items.findIndex(v => v.n === idx.current)
  if (i <= 0) throw createError({ statusCode: 422, message: 'Nothing to undo' })
  await restoreVersion(pid, sid, idx.items[i - 1]!.n)
  return projectView(pid)
})
