// Permanently removes one trashed scene or project.
export default defineEventHandler(async (event) => {
  const { kind, id, pid } = await readBody<{ kind: 'scene' | 'project', id: string, pid?: string }>(event)
  if (kind === 'scene') await purgeScene(assertId(pid), id)
  else await purgeProject(id)
  return { ok: true }
})
