export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const sid = assertId(getRouterParam(event, 'sid'))
  await restoreVersion(pid, sid, Number(getRouterParam(event, 'n')))
  return projectView(pid)
})
