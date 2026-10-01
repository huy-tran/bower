// Opens the OS folder chooser on the machine running Bower and returns the chosen path (null if cancelled).
export default defineEventHandler(async (event) => {
  // Only the Bower page itself may pop a dialog on this desktop: refuse cross-site requests.
  const origin = getRequestHeader(event, 'origin')
  if (origin && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403, message: 'Cross-origin requests are not allowed' })

  const body = await readBody<{ title?: string, initial?: string }>(event).catch(() => ({} as { title?: string, initial?: string }))
  const path = await pickFolder(typeof body?.title === 'string' ? body.title : undefined, typeof body?.initial === 'string' ? body.initial : undefined)
  return { path }
})
