export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const key = assertId(getRouterParam(event, 'key'))
  const q = getQuery(event)
  if (q.cancel) {
    cancelJob(pid, key)
    return { ok: true }
  }
  // Start the next request on a fresh Claude session but keep the messages on screen.
  if (q.session) {
    const chat = await getChat(pid, key)
    await saveChat(pid, key, { ...chat, sessionId: null, sessionTurns: 0 })
    return { ok: true }
  }
  await saveChat(pid, key, { sessionId: null, messages: [] })
  return { ok: true }
})
