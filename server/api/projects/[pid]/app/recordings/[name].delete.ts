export default defineEventHandler(event => removeRecording(getRouterParam(event, 'pid')!, getRouterParam(event, 'name')!))
