export default defineEventHandler(async (event) => {
  const { app } = await projectApp(getRouterParam(event, 'pid')!)
  await removeLogin(app.id)
  return { saved: null }
})
