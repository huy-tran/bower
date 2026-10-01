export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(x => x.name === 'file' && x.filename)
  if (!file) throw createError({ statusCode: 422, message: 'No file uploaded' })
  const p = await importBundle(new Uint8Array(file.data))
  return { id: p.id, name: p.name }
})
