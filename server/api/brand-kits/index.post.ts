export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name?: string }>(event)
  if (!name?.trim()) throw createError({ statusCode: 422, message: 'Name is required' })
  return createKit(name.trim())
})
