export default defineEventHandler(event => listUiSnapshots(getRouterParam(event, 'pid')!))
