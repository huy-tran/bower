export default defineEventHandler(async (event) => {
  const { name, folder } = await readBody<{ name?: string, folder?: string }>(event)
  if (!name?.trim()) throw createError({ statusCode: 422, message: 'Name is required' })
  return createProject(name.trim(), undefined, undefined, typeof folder === 'string' ? folder : '')
})
