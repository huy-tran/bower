export default defineEventHandler(async (event) => {
  const { path } = await readBody<{ path?: string }>(event)
  return { folders: await createFolder(String(path ?? '')) }
})
