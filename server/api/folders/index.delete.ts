export default defineEventHandler(async (event) => {
  const { path } = getQuery(event)
  return { folders: await deleteFolder(String(path ?? '')) }
})
