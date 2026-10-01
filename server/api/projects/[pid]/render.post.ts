// Queue a render. Renders run one at a time across all projects; the response says where this one sits.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const body = await readBody<{ fps?: number, sceneId?: string, scale?: number, format?: RenderFormat }>(event)
  const url = getRequestURL(event)
  return enqueueRender(pid, `${url.protocol}//${url.host}`, body)
})
