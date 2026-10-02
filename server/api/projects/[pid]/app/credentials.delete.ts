export default defineEventHandler(async (event) => {
  await removeLogin(getRouterParam(event, 'pid')!)
  return { saved: null }
})
