import { useEffect, useState } from 'react'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number) { super(status === 404 ? '资料不存在或已移除。' : '暂时无法读取资料，请稍后重试。'); this.status = status }
}
const base = import.meta.env.VITE_MEDIA_API_URL || new URL('api/', new URL(import.meta.env.BASE_URL, window.location.origin)).href
export function useMediaRequest<T>(path: string) {
  const [retry, setRetry] = useState(0)
  const key = path + '#' + retry
  const [result, setResult] = useState<{ key: string; data?: T; error?: ApiError }>()
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(base.replace(/\/?$/, '/') + path, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
        if (!response.ok) throw new ApiError(response.status)
        const data: T = await response.json()
        if (!controller.signal.aborted) setResult({ key, data })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof ApiError ? error : new ApiError(0) })
      }
    }
    void load()
    return () => controller.abort()
  }, [path, key])
  const current = result?.key === key ? result : undefined
  return { data: current?.data, error: current?.error, loading: !current, reload: () => setRetry(value => value + 1) }
}
