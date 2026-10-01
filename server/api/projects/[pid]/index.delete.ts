export default defineEventHandler(async (event) => {
  await trashProject(assertId(getRouterParam(event, 'pid')))
  return { projects: await listProjects() }
})
