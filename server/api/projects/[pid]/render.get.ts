export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  return { job: getRenderJob(pid), renders: await listRenders(pid) }
})
