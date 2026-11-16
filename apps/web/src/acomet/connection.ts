import { connect, type Frame } from '@acomet/module-sdk'
import type { MediaTransport } from '../api'

let connection: Promise<Frame> | undefined
export function connectAcomet() {
  connection ??= connect({ hostOrigins: [import.meta.env.VITE_ACOMET_HOST_ORIGIN], timeout: 10000 })
    .catch(error => { connection = undefined; throw error })
  return connection
}

export function createAcometTransport(frame: Frame): MediaTransport {
  const backend = import.meta.env.VITE_BACKEND_ORIGIN
  return async (path, signal) => {
    signal.throwIfAborted()
    const token = await frame.getToken()
    signal.throwIfAborted()
    return fetch(backend + '/api/' + path, {
      cache: 'no-store', credentials: 'omit', signal,
      headers: { authorization: `Bearer ${token}` },
    })
  }
}
