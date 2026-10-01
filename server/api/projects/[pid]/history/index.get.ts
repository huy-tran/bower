export default defineEventHandler(event => projectHistory(getRouterParam(event, 'pid')!))
