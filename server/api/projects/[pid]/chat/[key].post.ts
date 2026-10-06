export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const key = assertId(getRouterParam(event, 'key'))
  const body = await readBody<{ message?: string, model?: string, task?: string, attachments?: string[], at?: number }>(event)
  if (!body.message?.trim()) throw createError({ statusCode: 422, message: 'Message is required' })
  const url = getRequestURL(event)
  return {
    job: await startChat(pid, key, body.message.trim(), {
      origin: `${url.protocol}//${url.host}`,
      model: body.model,
      task: body.task === 'build' ? 'build' : 'chat',
      attachments: Array.isArray(body.attachments) ? body.attachments.map(String) : undefined,
      at: Number.isFinite(Number(body.at)) && body.at !== null && body.at !== undefined ? Number(body.at) : undefined
    })
  }
})
