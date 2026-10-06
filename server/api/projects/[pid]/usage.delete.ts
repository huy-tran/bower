import { resetUsage } from '../../../utils/usage'

// Start counting again from now, for example after invoicing the work so far.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  await loadProject(pid)
  return resetUsage(pid)
})
