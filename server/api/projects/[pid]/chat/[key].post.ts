export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const key = assertId(getRouterParam(event, 'key'))
  const body = await readBody<{ message?: string, model?: string, task?: string, attachments?: string[], at?: number, target?: { selector?: unknown, text?: unknown, html?: unknown } }>(event)
  if (!body.message?.trim()) throw createError({ statusCode: 422, message: 'Message is required' })
  const url = getRequestURL(event)
  const t = body.target
  const target = t && typeof t.selector === 'string' && t.selector.trim()
    ? { selector: t.selector.trim().slice(0, 300), text: typeof t.text === 'string' ? t.text.slice(0, 200) : undefined, html: typeof t.html === 'string' ? t.html.slice(0, 300) : undefined }
    : undefined
  return {
    job: await startChat(pid, key, body.message.trim(), {
      origin: `${url.protocol}//${url.host}`,
      model: body.model,
      task: body.task === 'build' ? 'build' : 'chat',
      attachments: Array.isArray(body.attachments) ? body.attachments.map(String) : undefined,
      target,
      at: Number.isFinite(Number(body.at)) && body.at !== null && body.at !== undefined ? Number(body.at) : undefined
    })
  }
})
