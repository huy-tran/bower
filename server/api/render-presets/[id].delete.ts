export default defineEventHandler(async event => ({ presets: await removeRenderPreset(getRouterParam(event, 'id')!) }))
