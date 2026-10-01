// Save this scene as a reusable template.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const sid = assertId(getRouterParam(event, 'sid'))
  const { name, description } = await readBody<{ name?: string, description?: string }>(event)
  const url = getRequestURL(event)
  return saveTemplate(`${url.protocol}//${url.host}`, pid, sid, String(name ?? ''), String(description ?? ''))
})
