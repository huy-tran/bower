export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const key = assertId(getRouterParam(event, 'key'))
  const chat = await getChat(pid, key)
  return { messages: chat.messages, job: getJob(pid, key) }
})
