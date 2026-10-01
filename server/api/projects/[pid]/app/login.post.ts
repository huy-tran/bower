// Opens a visible browser window on the app so the user can sign in; the session is kept for later captures.
export default defineEventHandler(async (event) => {
  const { target } = await readBody<{ target?: string }>(event).catch(() => ({} as { target?: string }))
  return openLogin(getRouterParam(event, 'pid')!, typeof target === 'string' ? target : undefined)
})
