export default defineEventHandler(async (event) => {
  const pid = getQuery(event).pid as string | undefined
  return {
    scenes: pid ? await listTrashedScenes(assertId(pid)) : [],
    projects: await listTrashedProjects()
  }
})
