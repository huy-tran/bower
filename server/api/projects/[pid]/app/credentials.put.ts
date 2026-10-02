// Save a login so Bower can sign in by itself when the session runs out. The password is encrypted for this
// Windows user (see utils/session.ts) and never leaves this machine.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ user?: string, password?: string }>(event)
  return saveLogin(getRouterParam(event, 'pid')!, String(body?.user ?? ''), String(body?.password ?? ''))
})
