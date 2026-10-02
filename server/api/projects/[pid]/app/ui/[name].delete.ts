export default defineEventHandler(event => removeUiSnapshot(getRouterParam(event, 'pid')!, getRouterParam(event, 'name')!))
