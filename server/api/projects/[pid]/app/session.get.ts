// Sign-in status for the App tab: the last check, whether a login is saved, and whether a visible window is
// open. All of it belongs to the project's shared app.
export default defineEventHandler(async (event) => {
  const p = await loadProject(getRouterParam(event, 'pid')!)
  if (!p.app) return { saved: null, savedSupported: savedLoginSupported, open: null }
  return { ...await readSession(p.app.id), saved: await getSavedLogin(p.app.id), savedSupported: savedLoginSupported, open: visibleKind(p.app.id) }
})
