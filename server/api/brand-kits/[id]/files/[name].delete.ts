export default defineEventHandler(async event => removeKitFile(assertId(getRouterParam(event, 'id')), getRouterParam(event, 'name')!))
