// Have Claude write the "Getting around" notes from a walk through the app's menus. Poll with GET.
export default defineEventHandler((event) => {
  setResponseStatus(event, 202)
  return startNotes(getRouterParam(event, 'pid')!)
})
