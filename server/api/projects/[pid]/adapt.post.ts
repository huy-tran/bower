const FORMATS: Record<string, { width: number, height: number, label: string, use: string }> = {
  '9:16': { width: 1080, height: 1920, label: '9:16', use: 'vertical video for Reels, TikTok and YouTube Shorts' },
  '1:1': { width: 1080, height: 1080, label: '1:1', use: 'a square social post' },
  '4:5': { width: 1080, height: 1350, label: '4:5', use: 'a portrait Instagram or LinkedIn feed post' },
  '16:9': { width: 1920, height: 1080, label: '16:9', use: 'landscape video' }
}

// Copy the project at a new stage size, then have Claude re-lay out every scene for it.
export default defineEventHandler(async (event) => {
  const pid = assertId(getRouterParam(event, 'pid'))
  const { format } = await readBody<{ format: string }>(event)
  const f = FORMATS[format]
  if (!f) throw createError({ statusCode: 422, message: 'Unknown format' })
  const src = await loadProject(pid)
  const p = await duplicateProject(pid, { name: `${src.name} (${f.label})`, width: f.width, height: f.height })
  const url = getRequestURL(event)
  await startChat(p.id, 'project', [
    `This project was copied from a ${src.width}x${src.height} version and the stage is now ${f.width}x${f.height} (${f.label}, ${f.use}).`,
    'Every scene file still has the old layout. Re-lay out every scene for the new stage: reposition and resize elements, re-wrap or resize text,',
    'and restack side-by-side layouts vertically where the frame is narrower. Keep the same content, choreography, timing and style.',
    'Keep important content inside a safe area 8% in from every edge. Check each scene with the snapshot tool if it is available.'
  ].join(' '), { origin: `${url.protocol}//${url.host}`, task: 'build' })
  return { id: p.id, name: p.name }
})
