export default defineEventHandler(async event => ({ presets: await createRenderPreset(await readBody(event)) }))
