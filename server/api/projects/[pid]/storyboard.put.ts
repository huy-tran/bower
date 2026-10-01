// Create the scenes of an (edited) storyboard.
export default defineEventHandler(async (event) => {
  const pid = getRouterParam(event, 'pid')!
  const body = await readBody<{ scenes?: PlanScene[], mode?: 'append' | 'replace' }>(event)
  if (!Array.isArray(body?.scenes) || !body.scenes.length) throw createError({ statusCode: 422, message: 'The storyboard has no scenes' })
  return applyPlan(pid, body.scenes, body.mode === 'replace' ? 'replace' : 'append')
})
