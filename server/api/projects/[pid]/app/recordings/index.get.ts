export default defineEventHandler(event => listRecordings(getRouterParam(event, 'pid')!))
