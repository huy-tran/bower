// Ask Claude to read a linked repository and write its "where to look" note. Returns the job; poll with GET.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const { path } = await readBody<{ path?: string }>(event)
  if (!path) throw createError({ statusCode: 422, message: 'Repository path is required' })
  setResponseStatus(event, 202)
  return startScan(pid, String(path))
})
