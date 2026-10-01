export default defineEventHandler(event => getVersions(getRouterParam(event, 'pid')!, assertId(getRouterParam(event, 'sid'))))
