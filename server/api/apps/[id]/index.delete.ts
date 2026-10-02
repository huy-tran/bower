import { deleteApp } from '../../../utils/apps'

// Removes an app no project uses, with its sign-in (Chrome profile and any saved login).
export default defineEventHandler(async (event) => {
  await deleteApp(getRouterParam(event, 'id')!)
  return { ok: true }
})
