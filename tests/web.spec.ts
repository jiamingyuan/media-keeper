import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { MediaRecord, SourceType } from '@media-keeper/core'

const types: SourceType[] = ['article', 'paper', 'podcast', 'video', 'tech_doc', 'project_repo']
const baseRecords: MediaRecord[] = [
  { id:'101', title:'Module Federation：构建可独立发布的前端模块', source:'Module Federation', source_type:'tech_doc', author:null, abstract:'理解宿主、远程模块与共享依赖的协作方式，把独立开发的工具组合进同一个工作台。\n从模块注册到运行时加载，为持续扩展的个人工具保留清晰边界。', link:'https://module-federation.io/', copied_lark_link:null, source_created_at:'2026-10-22T04:00:00Z', created_at:'2026-10-23T01:42:00Z', updated_at:'2026-10-23T01:42:00Z' },
  { id:'102', title:'media-keeper：从采集 Skill 到可查询的资料库', source:'GitHub', source_type:'project_repo', author:'jiamingyuan', abstract:'将分散在文章、论文和技术文档里的信息沉淀为统一资料库，以摘要帮助快速判断内容价值。\n通过标题、来源、类型、作者与发布日期，重新找到曾经收藏的资料。', link:'https://github.com/jiamingyuan/media-keeper', copied_lark_link:null, source_created_at:'2026-10-19T04:00:00Z', created_at:'2026-10-22T04:00:00Z', updated_at:'2026-10-22T04:00:00Z' },
  { id:'103', title:'以摘要为入口，建立可回看的个人资料库', source:'个人笔记', source_type:'article', author:null, abstract:'收藏不止于保存链接。用简洁的摘要与稳定的来源信息，让内容在下一次需要时依然可被找到。\n在浏览与原文阅读之间，保留一次轻量的判断。', link:null, copied_lark_link:'https://example.feishu.cn/docx/example', source_created_at:null, created_at:'2026-10-21T04:00:00Z', updated_at:'2026-10-21T04:00:00Z' },
]
const records: MediaRecord[] = [...baseRecords, ...Array.from({length:20}, (_, i) => ({ ...baseRecords[0], id:String(104+i), title:'Alpha '+i, source_type:types[i%6] }))]
async function api(page: Page, values = records) {
  const requests: URL[] = []
  await page.route('**/media-keeper/api/media**', route => {
    const url = new URL(route.request().url()); requests.push(url)
    const id = url.pathname.match(/\/media\/(\d+)$/)?.[1]
    if(id) { const record = values.find(r => r.id === id); return route.fulfill({ status:record?200:404, json:record?{data:record}:{error:{message:'missing'}} }) }
    let filtered = values.filter(r => r.title.includes(url.searchParams.get('title') ?? ''))
    const source_type_counts = Object.fromEntries(types.map(type => [type, filtered.filter(r => r.source_type===type).length]))
    const type=url.searchParams.get('source_type'); if(type) filtered=filtered.filter(r => r.source_type===type)
    const page=Number(url.searchParams.get('page') ?? 1), size=Number(url.searchParams.get('page_size') ?? 20)
    return route.fulfill({ json:{data:filtered.slice((page-1)*size,page*size),source_type_counts,pagination:{page,page_size:size,total:filtered.length,total_pages:Math.ceil(filtered.length/size)}} })
  })
  return requests
}
test('real federation remote, server query parameters, pagination and detail retain URL state', async ({page}) => {
  const requests=await api(page); const loaded:string[]=[]; page.on('request',r=>loaded.push(r.url()))
  await page.goto('/'); await expect(page.getByRole('main')).not.toContainText('media-keeper')
  await page.getByRole('link',{name:'media-keeper',exact:true}).click()
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  expect(loaded.some(url=>url.includes('mf-manifest.json'))).toBe(true)
  expect(loaded.some(url=>url.includes('remoteEntry'))).toBe(true)
  await expect(page.getByLabel('当前位置')).toContainText('media-keeper')
  await expect(page.getByRole('heading',{name:'media-keeper',exact:true})).toHaveCount(1)
  await expect(page.locator('input')).toHaveCount(1)
  await page.getByRole('textbox',{name:'标题关键词'}).or(page.getByRole('searchbox',{name:'标题关键词'})).fill('Alpha')
  await page.getByRole('button',{name:'查询',exact:true}).click()
  await expect(page).toHaveURL(/title=Alpha/)
  await expect(page.getByRole('heading',{name:'Alpha 0',exact:true})).toBeVisible()
  await expect.poll(() => requests.at(-1)?.searchParams.get('title')).toBe('Alpha')
  for(const value of ['today','week','month','year','all']) {
    await page.getByLabel('发布日期',{exact:true}).selectOption(value)
    await page.getByRole('button',{name:'查询',exact:true}).click()
    await expect(page.locator('section[aria-label="Media"]')).toHaveAttribute('aria-busy','false')
    await expect.poll(() => requests.at(-1)?.searchParams.get('published')).toBe(value==='all'?null:value)
  }
  await page.getByRole('button',{name:'重置',exact:true}).click()
  await page.getByRole('navigation',{name:'资料类型'}).getByRole('link',{name:/^技术文档/}).click()
  await expect(page).toHaveURL(/source_type=tech_doc/)
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  await expect.poll(() => requests.at(-1)?.searchParams.get('source_type')).toBe('tech_doc')
  await expect(page.getByRole('navigation',{name:'资料类型'}).getByRole('link',{name:/^全部/})).toHaveText('全部23')
  await page.getByRole('navigation',{name:'资料类型'}).getByRole('link',{name:/^播客/}).click()
  await expect(page).toHaveURL(/source_type=podcast/)
  await expect.poll(() => requests.at(-1)?.searchParams.get('source_type')).toBe('podcast')
  await expect(page.getByRole('heading',{name:'Alpha 2',exact:true})).toBeVisible()
  await expect(page.getByRole('navigation',{name:'资料类型'})).not.toContainText('博客')
  await page.getByRole('button',{name:'重置',exact:true}).click()
  await page.getByRole('button',{name:'下一页',exact:true}).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('heading',{name:'Alpha 19',exact:true})).toBeVisible()
  await page.getByRole('link',{name:'Alpha 19',exact:true}).click()
  await expect(page.getByRole('heading',{name:'摘要',exact:true})).toBeVisible()
  await expect(page).toHaveURL(/\/123\?page=2$/)
  await page.reload(); await expect(page.getByRole('heading',{name:'摘要',exact:true})).toBeVisible()
  await page.getByRole('link',{name:'← 返回资料库',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Alpha 19',exact:true})).toBeVisible()
  await page.getByLabel('资料排序',{exact:true}).selectOption('published')
  await expect(page).toHaveURL(/sort=published$/)
  await expect(page.locator('section[aria-label="Media"]')).toHaveAttribute('aria-busy','false')
  await expect.poll(() => requests.at(-1)?.searchParams.get('sort_by')).toBe('source_created_at')
  await page.goBack(); await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('heading',{name:'Alpha 19',exact:true})).toBeVisible()
})
test('design assets, readable summaries, themes and small screens', async ({page},info) => {
  await api(page,baseRecords); const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/tools/media-keeper')
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  const icons=page.getByRole('navigation',{name:'资料类型'}).locator('span[aria-hidden]')
  await expect(icons).toHaveCount(6)
  for(const icon of await icons.all()) {
    const asset=await icon.evaluate(e=>({mask:getComputedStyle(e).maskImage,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))
    expect(asset.width).toBe(16);expect(asset.height).toBe(16); expect(asset.mask).toMatch(/assets\/.+\.svg/)
    const url=asset.mask.match(/url\("?([^"\)]+)"?\)/)?.[1]; expect(url).toBeTruthy()
    expect((await page.request.get(url!)).status()).toBe(200)
  }
  await expect(page.getByText('飞书文档转存',{exact:true})).toHaveCount(1)
  for(const theme of ['夜间','晨间']) {
    await page.getByRole('button',{name:theme,exact:true}).click()
    await expect(page.locator('[data-media-theme]')).toHaveAttribute('data-media-theme',theme==='夜间'?'night':'morning')
    expect(await page.locator('article').first().evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(theme==='夜间'?'rgb(36, 37, 33)':'rgb(248, 245, 239)')
    const fonts=await page.locator('[data-media-theme] *').evaluateAll(elements=>[...new Set(elements.map(e=>getComputedStyle(e).fontFamily))]);expect(fonts.every(f=>f.includes('PingFang SC'))).toBe(true)
    await page.screenshot({path:info.outputPath(theme==='夜间'?'night.png':'morning.png'),fullPage:true})
  }
  await page.getByRole('link',{name:baseRecords[2].title,exact:true}).click()
  await expect(page.getByRole('link',{name:'阅读飞书副本 ↗',exact:true})).toHaveAttribute('target','_blank')
  await expect(page.getByRole('link',{name:'阅读原文 ↗',exact:true})).toHaveCount(0)
  await page.screenshot({path:info.outputPath('detail.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('link',{name:'← 返回资料库',exact:true}).click()
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath('mobile.png'),fullPage:true})
  expect(errors).toEqual([])
})
test('empty, unavailable and missing records recover without breaking the shell', async ({page}) => {
  await api(page,baseRecords)
  let failed=true
  await page.route('**/media-keeper/api/media?**',async route=>failed?route.fulfill({status:503,json:{error:{message:'unavailable'}}}):route.fallback())
  await page.goto('/tools/media-keeper')
  await expect(page.getByRole('heading',{name:'资料暂时无法加载',exact:true})).toBeVisible()
  failed=false;await page.getByRole('button',{name:'重试',exact:true}).click()
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  await page.getByRole('searchbox',{name:'标题关键词'}).fill('没有这个标题')
  await page.getByRole('button',{name:'查询',exact:true}).click()
  await expect(page.getByRole('heading',{name:'暂无符合条件的资料',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'查看全部资料'}).click()
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  await page.goto('/tools/media-keeper/999')
  await expect(page.getByRole('heading',{name:'资料不存在',exact:true})).toBeVisible()
  await page.getByRole('link',{name:'← 返回资料库'}).click()
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
})
test('late responses do not overwrite newer filters; unsafe full-text URLs stay inert',async({page})=>{
  await api(page,[{...baseRecords[0],link:'javascript:alert(1)',copied_lark_link:null}])
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve})
  let observed!:()=>void;const slow=new Promise<void>(resolve=>{observed=resolve})
  await page.route('**/media-keeper/api/media?**',async route=>{
    if(new URL(route.request().url()).searchParams.get('title')!=='slow') return route.fallback()
    observed();await gate;await route.fulfill({json:{data:[],source_type_counts:{},pagination:{page:1,page_size:20,total:0,total_pages:0}}}).catch(()=>{})
  })
  await page.goto('/tools/media-keeper');await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  await page.getByRole('searchbox',{name:'标题关键词'}).fill('slow');await page.getByRole('button',{name:'查询',exact:true}).click();await slow
  await page.getByRole('searchbox',{name:'标题关键词'}).fill('Module');await page.getByRole('button',{name:'查询',exact:true}).click()
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible();release()
  await expect(page.getByRole('heading',{name:baseRecords[0].title,exact:true})).toBeVisible()
  await page.getByRole('link',{name:baseRecords[0].title,exact:true}).click();await expect(page.getByRole('heading',{name:'摘要',exact:true})).toBeVisible()
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(page.getByText('暂无可用的全文链接')).toBeVisible()
})
