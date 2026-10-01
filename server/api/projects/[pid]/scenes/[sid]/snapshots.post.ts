export default defineEventHandler(async (event) => {
  const pid = assertId(getRouterParam(event, 'pid'))
  const sid = assertId(getRouterParam(event, 'sid'))
  const body = await readBody<{ times?: number[] }>(event).catch(() => null)
  const url = getRequestURL(event)
  const times = Array.isArray(body?.times) ? body.times.map(Number).filter(Number.isFinite) : undefined
  return { files: await snapScene(`${url.protocol}//${url.host}`, pid, sid, times) }
})
