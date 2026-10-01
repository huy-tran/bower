// Cancel the running render (no id) or remove a queued one (?id=).
export default defineEventHandler((event) => {
  const { id } = getQuery(event)
  cancelRender(getRouterParam(event, 'pid')!, typeof id === 'string' ? id : undefined)
  return getRenderStatus(getRouterParam(event, 'pid')!)
})
