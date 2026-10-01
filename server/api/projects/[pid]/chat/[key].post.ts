export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const key = assertId(getRouterParam(event, 'key'))
  const { message } = await readBody<{ message?: string }>(event)
  if (!message?.trim()) throw createError({ statusCode: 422, message: 'Message is required' })
  return { job: await startChat(pid, key, message.trim()) }
})
