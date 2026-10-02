export default defineEventHandler(event => stopRecording(getRouterParam(event, 'pid')!))
