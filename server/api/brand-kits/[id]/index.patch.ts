export default defineEventHandler(async event => updateKit(assertId(getRouterParam(event, 'id')), await readBody(event)))
