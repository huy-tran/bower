export default defineEventHandler(async (event) => {
  const pid = assertId(getRouterParam(event, 'pid'))
  const sceneId = getQuery(event).sceneId as string | undefined
  const url = getRequestURL(event)
  return { seams: await checkSeams(`${url.protocol}//${url.host}`, pid, sceneId ? assertId(sceneId) : undefined) }
})
