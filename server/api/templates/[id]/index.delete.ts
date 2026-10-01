export default defineEventHandler(event => removeTemplate(getRouterParam(event, 'id')!))
