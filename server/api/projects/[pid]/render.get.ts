export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  return { ...getRenderStatus(pid), renders: await listRenders(pid) }
})
