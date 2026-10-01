export default defineEventHandler(async (event) => {
  const id = assertId(getRouterParam(event, 'id'))
  const parts = await readMultipartFormData(event)
  const files = (parts ?? []).filter(x => x.name === 'file' && x.filename)
  if (!files.length) throw createError({ statusCode: 422, message: 'No file uploaded' })
  let kit = await loadKit(id)
  for (const f of files) kit = await addKitFile(id, f.filename!, f.data)
  return kit
})
