// "Test connection": reach the app, and check the session (signing in with the saved login if there is one).
export default defineEventHandler(event => checkApp(getRouterParam(event, 'pid')!))
