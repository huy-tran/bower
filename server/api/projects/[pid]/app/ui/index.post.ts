// Save a live UI snapshot of a page of the running app: real markup and CSS a scene can animate (utils/uisnap.ts).
export default defineEventHandler(async (event) => {
  const body = await readBody<UiOptions>(event)
  if (!body || typeof body.target !== 'string') throw createError({ statusCode: 422, message: 'Give a page path or URL to capture' })
  return captureUi(getRouterParam(event, 'pid')!, body)
})
