// Soft delete: the scene, its versions and its chat move to the project's trash.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  await trashScene(pid, assertId(getRouterParam(event, 'sid')))
  return projectView(pid)
})
