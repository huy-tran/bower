import { appUsage, listApps } from '../../utils/apps'

// Every shared app on this machine, with the projects that use it.
export default defineEventHandler(async () => {
  const usage = await appUsage()
  return (await listApps()).map(a => ({ ...a, projects: usage.get(a.id) ?? [] }))
})
