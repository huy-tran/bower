export default defineEventHandler(event => ({ open: loginOpen(getRouterParam(event, 'pid')!) }))
