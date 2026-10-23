import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent, ReactNode } from 'react'
import type { MediaRecord, SourceType } from '@media-keeper/core'
import { useMediaRequest } from './api'
import { apiSearch, filterSearch, publishedLabels, readableDate, readFilters, safeLink, sortOptions, sourceLabels, sourceTypes } from './query'
import type { Filters } from './query'
import { SourceIcon } from './SourceIcon'
import styles from './Media.module.css'

// Structural contract shared with my-dashboard; the remote owns no React root or router.
interface DashboardModuleProps {
  theme: 'night' | 'morning'; basePath: string; path: string; search: string; navigate: (to: string) => void
}
interface MediaPage { data: MediaRecord[]; source_type_counts: Record<SourceType, number>; pagination: { page: number; page_size: number; total: number; total_pages: number } }
function follow(event: MouseEvent<HTMLAnchorElement>, to: string, navigate: DashboardModuleProps['navigate']) {
  if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(to) }
}
function TypeBadge({ type }: { type: SourceType }) { return <span className={styles.badge}><SourceIcon type={type} />{sourceLabels[type] ?? type}</span> }
function CopyTag({ record }: { record: MediaRecord }) { return safeLink(record.copied_lark_link) ? <span className={styles.copyTag}>飞书文档转存</span> : null }
function Abstract({ text }: { text: string }) { return <div className={styles.abstract}>{text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div> }
function Message({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className={styles.message} role="status"><h3>{title}</h3><p>{children}</p>{action}</div>
}
function FilterForm({ filters, apply }: { filters: Filters; apply: (patch: Partial<Filters>) => void }) {
  const [title, setTitle] = useState(filters.title)
  const [published, setPublished] = useState(filters.published)
  function submit(event: FormEvent) { event.preventDefault(); apply({ title: title.trim(), published, page: 1 }) }
  return <form className={styles.filters} role="search" aria-label="筛选资料" onSubmit={submit}>
    <input aria-label="标题关键词" placeholder="搜索标题关键词" type="search" maxLength={512} value={title} onChange={event => setTitle(event.target.value)} />
    <select aria-label="发布日期" value={published} onChange={event => setPublished(event.target.value as Filters['published'])}>
      {(['today', 'week', 'month', 'year', 'all'] as const).map(value => <option key={value} value={value}>发布日期：{publishedLabels[value]}</option>)}
    </select>
    <button className={styles.secondary} type="button" onClick={() => { setTitle(''); setPublished('all'); apply({ title: '', published: 'all', source_type: '', sort: 'newest', page: 1 }) }}>重置</button>
    <button className={styles.primary} type="submit">查询</button>
  </form>
}
function MediaList({ basePath, search, navigate }: DashboardModuleProps) {
  const filters = useMemo(() => readFilters(search), [search])
  const { data, error, loading, reload } = useMediaRequest<MediaPage>('media?' + apiSearch(filters))
  const update = (patch: Partial<Filters>) => navigate(basePath + filterSearch({ ...filters, ...patch }))
  const count = (type: SourceType | '') => !data ? '—' : type ? data.source_type_counts[type] ?? 0 : Object.values(data.source_type_counts).reduce((a, b) => a + b, 0)
  const pages = data?.pagination.total_pages ?? 0
  return <>
    <FilterForm key={JSON.stringify([filters.title, filters.published])} filters={filters} apply={update} />
    <section className={styles.browser} aria-label="Media" aria-busy={loading}>
      <div className={styles.collectionHeading}><h2>Media <span>{data ? data.pagination.total + ' 条' : '加载中'}</span></h2>
        <select aria-label="资料排序" value={filters.sort} onChange={event => update({ sort: event.target.value as Filters['sort'], page: 1 })}>
          {Object.entries(sortOptions).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
        </select>
      </div>
      <nav className={styles.typeNav} aria-label="资料类型">
        {(['', ...sourceTypes] as const).map(type => {
          const href = basePath + filterSearch({ ...filters, source_type: type, page: 1 })
          return <a key={type} href={href} className={styles.typeTab} aria-current={filters.source_type === type ? 'page' : undefined} onClick={event => follow(event, href, navigate)}>
            {type && <SourceIcon type={type} />}{type ? sourceLabels[type] : '全部'}<span>{count(type)}</span>
          </a>
        })}
      </nav>
      {loading ? <Message title="正在读取资料">请稍候。</Message>
        : error ? <Message title="资料暂时无法加载" action={<button className={styles.secondary} type="button" onClick={reload}>重试</button>}>{error.message}</Message>
        : !data?.data.length ? <Message title={filters.page > 1 && data?.pagination.total ? '这一页没有资料' : '暂无符合条件的资料'} action={<button className={styles.secondary} type="button" onClick={() => update({ title: '', published: 'all', source_type: '', page: 1 })}>查看全部资料</button>}>试试其他关键词、类型或发布时间。</Message>
        : <div className={styles.collection}>{data.data.map(record => {
          const href = basePath + '/' + record.id + filterSearch(filters)
          return <article key={record.id} className={styles.card}>
            <a href={href} className={styles.cardLink} aria-labelledby={'media-title-' + record.id} onClick={event => follow(event, href, navigate)}>
              <header className={styles.cardHeading}><TypeBadge type={record.source_type} /><div className={styles.titleGroup}><h3 id={'media-title-' + record.id}>{record.title}</h3><CopyTag record={record} /></div><SourceIcon type="arrow" /></header>
              <div className={styles.metadata}><span>来源 · {record.source}</span><span>作者 · {record.author || '未注明'}</span><span>发布 · {readableDate(record.source_created_at)}</span><span>收藏 · {readableDate(record.created_at)}</span></div>
              <Abstract text={record.abstract} />
            </a>
          </article>
        })}</div>}
      {data && <nav className={styles.pagination} aria-label="资料分页"><span>共 {data.pagination.total} 条资料 · 每页 {data.pagination.page_size} 条</span><div>
        <button className={styles.secondary} type="button" disabled={filters.page === 1} onClick={() => update({ page: filters.page - 1 })}>上一页</button>
        <span className={styles.currentPage} aria-current="page" aria-label={'第 ' + filters.page + ' 页'}>{filters.page}</span>
        <button className={styles.secondary} type="button" disabled={filters.page >= pages} onClick={() => update({ page: filters.page + 1 })}>下一页</button>
      </div></nav>}
    </section>
  </>
}
function MediaDetail({ id, basePath, search, navigate }: DashboardModuleProps & { id: string }) {
  const { data, error, loading, reload } = useMediaRequest<{ data: MediaRecord }>('media/' + id)
  const record = data?.data, heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (record) heading.current?.focus({ preventScroll: true }) }, [record])
  const back = basePath + filterSearch(readFilters(search))
  const original = safeLink(record?.link ?? null), copy = safeLink(record?.copied_lark_link ?? null)
  return <>
    <a className={styles.back} href={back} onClick={event => follow(event, back, navigate)}>← 返回资料库</a>
    {loading ? <Message title="正在读取资料">请稍候。</Message> : error ? <Message title={error.status === 404 ? '资料不存在' : '资料暂时无法加载'} action={error.status !== 404 && <button className={styles.secondary} type="button" onClick={reload}>重试</button>}>{error.message}</Message>
      : record && <div className={styles.detailColumns}>
        <article className={styles.summaryCard}>
          <div className={styles.detailTop}><TypeBadge type={record.source_type} /><span>收藏于 {readableDate(record.created_at)}</span></div>
          <div className={styles.detailTitle}><h2 ref={heading} tabIndex={-1}>{record.title}</h2><CopyTag record={record} /></div>
          <div className={styles.metadata}><span className={styles.accent}>{record.source}</span><span>{record.author || '作者未注明'}</span></div>
          <section className={styles.summary}><h3>摘要</h3><Abstract text={record.abstract} /></section>
          <div className={styles.readingLinks}>{original && <a className={styles.primary} href={original} target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>}{copy && <a className={original ? styles.secondary : styles.primary} href={copy} target="_blank" rel="noopener noreferrer">阅读飞书副本 ↗</a>}{(original || copy) ? <span>在新标签页打开</span> : <span>暂无可用的全文链接</span>}</div>
        </article>
        <aside className={styles.sourceInfo} aria-label="资料信息"><h2>资料信息</h2><dl>
          {([['来源', record.source], ['类型', sourceLabels[record.source_type]], ['作者', record.author || '未注明'], ['发布日期', readableDate(record.source_created_at)], ['收藏时间', readableDate(record.created_at, true)]]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          {original && <div><dt>原文地址</dt><dd><a href={original} target="_blank" rel="noopener noreferrer">{new URL(original).hostname} ↗</a></dd></div>}
          {copy && <div><dt>飞书副本</dt><dd><a href={copy} target="_blank" rel="noopener noreferrer">打开飞书文档 ↗</a></dd></div>}
        </dl></aside>
      </div>}
  </>
}
export default function DashboardModule(props: DashboardModuleProps) {
  const id = props.path.match(/^\/([1-9]\d{0,19})\/?$/)?.[1]
  return <div className={styles.module} data-media-theme={props.theme}>
    {props.path === '/' || props.path === '' ? <MediaList {...props} /> : id ? <MediaDetail {...props} id={id} /> : <Message title="页面未找到">请从侧栏重新进入 Media。</Message>}
  </div>
}
