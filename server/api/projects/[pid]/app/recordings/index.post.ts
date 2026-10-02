// Record a flow of the running app as a video clip for scenes (see utils/flows.ts). Takes as long as the flow.
export default defineEventHandler(async (event) => {
  const body = await readBody<RecordOptions>(event)
  if (!body || typeof body.target !== 'string') throw createError({ statusCode: 422, message: 'Give a page path or URL to start from' })
  return recordFlow(getRouterParam(event, 'pid')!, body)
})
