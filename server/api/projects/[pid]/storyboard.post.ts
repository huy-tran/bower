// Ask Claude to draft a storyboard from a brief. Returns the job; poll with GET.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const body = await readBody<{ brief?: string, seconds?: number, narration?: boolean }>(event)
  if (!body?.brief?.trim()) throw createError({ statusCode: 422, message: 'Write a brief first' })
  setResponseStatus(event, 202)
  return startPlan(pid, body.brief, { seconds: Number(body.seconds) || undefined, narration: !!body.narration })
})
