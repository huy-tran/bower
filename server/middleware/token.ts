// Desktop app only (see utils/token.ts): every request must carry the session token, and requests
// that change something must come from the editor's own origin.
export default defineEventHandler((event) => {
  if (!TOKEN) return
  if (!tokenMatches(getCookie(event, TOKEN_COOKIE)) && !tokenMatches(getRequestHeader(event, TOKEN_HEADER))) {
    throw createError({ statusCode: 403, message: 'Not allowed' })
  }
  const origin = getRequestHeader(event, 'origin')
  if (event.method !== 'GET' && event.method !== 'HEAD' && origin && origin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, message: 'Cross-origin requests are not allowed' })
  }
})
