export default defineEventHandler(async (event) => {
  await closeLogin(getRouterParam(event, 'pid')!)
  return { open: false }
})
