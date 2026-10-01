export default defineEventHandler((event) => {
  cancelRender(getRouterParam(event, 'pid')!)
  return { ok: true }
})
