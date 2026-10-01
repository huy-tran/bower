// Capture a screenshot of a page in the running app into assets/shots.
export default defineEventHandler(async (event) => {
  const body = await readBody<ShotOptions>(event)
  if (!body || typeof body.target !== 'string') throw createError({ statusCode: 422, message: 'Give a page path or URL to capture' })
  return captureShot(getRouterParam(event, 'pid')!, body)
})
