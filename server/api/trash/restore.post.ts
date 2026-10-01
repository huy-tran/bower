export default defineEventHandler(async (event) => {
  const { kind, id, pid } = await readBody<{ kind: 'scene' | 'project', id: string, pid?: string }>(event)
  if (kind === 'scene') {
    const sceneId = await restoreScene(assertId(pid), id)
    return { sceneId, project: await projectView(pid!) }
  }
  return { projectId: await restoreProject(id), projects: await listProjects() }
})
