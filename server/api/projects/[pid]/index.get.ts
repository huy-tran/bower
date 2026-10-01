export default defineEventHandler(event => projectView(getRouterParam(event, 'pid')!))
