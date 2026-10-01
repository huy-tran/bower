export default defineEventHandler((event) => {
  const job = getPlan(getRouterParam(event, 'pid')!)
  if (!job) throw createError({ statusCode: 404, message: 'No storyboard in progress' })
  return job
})
