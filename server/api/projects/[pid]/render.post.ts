export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const body = await readBody<{ fps?: number, sceneId?: string, scale?: number }>(event)
  const url = getRequestURL(event)
  return { job: await startRender(pid, `${url.protocol}//${url.host}`, body) }
})
