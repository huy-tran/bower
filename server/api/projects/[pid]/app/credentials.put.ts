// Save a login so Bower can sign in by itself when the session runs out. It belongs to the shared app, so every
// project about the app uses it. The password is encrypted for this Windows user (see utils/session.ts) and
// never leaves this machine.
export default defineEventHandler(async (event) => {
  const { app } = await projectApp(getRouterParam(event, 'pid')!)
  const body = await readBody<{ user?: string, password?: string }>(event)
  return saveLogin(app.id, String(body?.user ?? ''), String(body?.password ?? ''))
})
