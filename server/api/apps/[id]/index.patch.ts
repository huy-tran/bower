import { cleanRepos, updateApp } from '../../../utils/apps'

// Edit a shared app: every project using it sees the change on its next chat.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ name?: string, url?: string, notes?: string, codebases?: unknown[] }>(event)
  return updateApp(id, {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.url !== undefined && { url: body.url }),
    ...(body.notes !== undefined && { notes: body.notes }),
    ...(Array.isArray(body.codebases) && { codebases: await cleanRepos(body.codebases) })
  })
})
