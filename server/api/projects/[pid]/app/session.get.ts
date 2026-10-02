// Sign-in status for the App tab: the last check, whether a login is saved, and whether a visible window is open.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  return { ...await readSession(pid), saved: await getSavedLogin(pid), savedSupported: savedLoginSupported, open: visibleKind(pid) }
})
