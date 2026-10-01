export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const key = assertId(getRouterParam(event, 'key'))
  if (getQuery(event).cancel) {
    cancelJob(pid, key)
    return { ok: true }
  }
  await saveChat(pid, key, { sessionId: null, messages: [] })
  return { ok: true }
})
