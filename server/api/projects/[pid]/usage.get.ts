import { readUsage } from '../../../utils/usage'

// Tokens and cost of every Claude run in this project.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  await loadProject(pid)
  return readUsage(pid)
})
