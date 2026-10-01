export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const { path } = getQuery(event)
  const job = getScan(pid, String(path ?? ''))
  if (!job) throw createError({ statusCode: 404, message: 'No scan for that repository' })
  return { ...job, project: job.status === 'done' ? await projectView(pid) : undefined }
})
