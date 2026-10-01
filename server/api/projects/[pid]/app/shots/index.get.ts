export default defineEventHandler(event => listShots(getRouterParam(event, 'pid')!))
