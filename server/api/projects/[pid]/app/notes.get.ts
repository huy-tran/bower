export default defineEventHandler((event) => {
  const job = getNotesJob(getRouterParam(event, 'pid')!)
  if (!job) throw createError({ statusCode: 404, message: 'No notes being written' })
  return job
})
