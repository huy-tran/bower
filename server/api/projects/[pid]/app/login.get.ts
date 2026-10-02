export default defineEventHandler(async event => ({ open: await loginOpen(getRouterParam(event, 'pid')!) }))
