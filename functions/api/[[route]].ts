import { handle } from 'hono/cloudflare-pages'
import { app } from '../../server/index'

export const onRequest = handle(app)

export { default as queue } from '../../server/queue-handler'
