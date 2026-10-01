export default defineEventHandler(async (event) => {
  const { path, name } = await readBody<{ path?: string, name?: string }>(event)
  return { folders: await renameFolder(String(path ?? ''), String(name ?? '')) }
})
