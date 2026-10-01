export default defineEventHandler(async (event) => {
  await deleteKit(assertId(getRouterParam(event, 'id')))
  return listKits()
})
