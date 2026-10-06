import { publishProject } from '../../../utils/publish'

// Publish the web player to this project's Cloudflare Pages site. The first time, `name` picks the site name.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string, replace?: boolean }>(event).catch(() => ({} as { name?: string, replace?: boolean }))
  return publishProject(getRouterParam(event, 'pid')!, { name: body.name, replace: !!body.replace })
})
