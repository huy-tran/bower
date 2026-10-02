export default defineEventHandler(event => getRecording(getRouterParam(event, 'pid')!) ?? { open: false, steps: [], start: '', skippedPassword: false })
