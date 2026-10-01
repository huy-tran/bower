export default defineEventHandler(event => removeShot(getRouterParam(event, 'pid')!, getRouterParam(event, 'name')!))
