import { StrictMode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { isEmbedded, type Frame } from '@acomet/module-sdk'
import DashboardModule from '../DashboardModule'
import { MediaTransportContext } from '../api'
import { connectAcomet, createAcometTransport } from './connection'
import './styles.css'

function ConnectedPage({ frame }: { frame: Frame }) {
  const subscribe = useCallback((notify: () => void) => frame.subscribe(() => notify()), [frame])
  const context = useSyncExternalStore(subscribe, () => frame.context)
  const transport = useMemo(() => createAcometTransport(frame), [frame])
  function navigate(to: string) {
    const relative = to.slice(context.basePath.length)
    frame.navigate(relative.startsWith('/') ? relative : '/' + relative)
  }
  return <MediaTransportContext value={transport}>
    <DashboardModule theme={context.theme} basePath={context.basePath} path={context.path} search={context.search}
      navigate={navigate} openLink={url => frame.openLink(url)} />
  </MediaTransportContext>
}

function Page() {
  const [frame, setFrame] = useState<Frame>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const embedded = isEmbedded()
  useEffect(() => {
    if (!embedded) return
    let active = true
    setFailed(false)
    void connectAcomet().then(value => { if (active) setFrame(value) }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [embedded, attempt])
  if (!embedded) return <main className="connection-status"><h1>Media</h1><p>请从 Acomet 的 Media 工具页打开。</p></main>
  if (frame) return <main><ConnectedPage frame={frame} /></main>
  return <main className="connection-status" role="status"><h1>{failed ? '暂时无法连接 Acomet' : '正在连接 Acomet'}</h1>
    <p>{failed ? '请确认宿主与模块的地址配置，然后重试。' : '连接后即可浏览收藏资料。'}</p>
    {failed && <button onClick={() => setAttempt(value => value + 1)}>重试</button>}
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>)
