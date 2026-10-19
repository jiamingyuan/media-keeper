#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { assert, KeeperError, canonicalUrl } from './lib.mjs';

export function extractPage(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const meta = key => doc.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute('content')?.trim() || null;
  let structured = [];
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const visit = value => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') {
          structured.push(value);
          if (value['@graph']) visit(value['@graph']);
          if (value.mainEntity) visit(value.mainEntity);
        }
      };
      visit(JSON.parse(el.textContent));
    } catch { /* malformed site metadata is not trusted */ }
  }
  const item = structured.find(x => /Article|BlogPosting|VideoObject|APIReference|SoftwareSourceCode/i.test([x['@type']].flat().join(','))) || {};
  const names = value => [value].flat().filter(Boolean).map(x => typeof x === 'string' ? x : x.name).filter(Boolean);
  const flags = [];
  if (doc.querySelector('link[rel="next"],a[rel="next"],.pagination,.pager')) flags.push('possible_pagination: 检查是否还有后续页面');
  if (doc.querySelector('input[type="password"]') || /^(登录|登入|sign in|log in)/i.test(doc.title)) flags.push('possible_login_wall: 检查是否只取得登录页');
  const article = new Readability(doc.cloneNode(true)).parse();
  const root = article?.content ? new JSDOM(article.content, { url }) : null;
  const main = root?.window.document.body || doc.querySelector('main,article') || doc.body;
  assert(main?.textContent.trim(), 'no_content', '网页没有可读取正文，请提供完整内容');
  if (!article?.content) flags.push('extraction_fallback: 未识别到文章主体，必须人工排除导航和广告');
  main.querySelectorAll('script,style,noscript,form,nav').forEach(x => x.remove());
  for (const el of main.querySelectorAll('[href],[src],img')) {
    for (const attr of ['href','src']) {
      let value = el.getAttribute(attr);
      if (attr === 'src' && el.tagName === 'IMG') value = el.getAttribute('data-src') || value;
      if (value) try { el.setAttribute(attr, new URL(value, url).href); } catch { flags.push('unresolved_resource: 有资源地址无法解析'); }
    }
  }
  if (main.querySelector('iframe,video,audio,canvas,math')) flags.push('embedded_media: 有嵌入媒体/公式，需要单独核对内容完整性');
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  td.use(gfm);
  td.addRule('literalCode', {
    filter: 'pre', replacement: (_, node) => {
      const text = node.textContent.replace(/\n$/, '');
      const max = Math.max(2, ...(text.match(/`+/g) || []).map(x => x.length));
      const fence = '`'.repeat(max + 1);
      const lang = node.querySelector('code')?.className.match(/language-([\w+-]+)/)?.[1] || '';
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    }
  });
  const markdown = td.turndown(main.innerHTML).trim() + '\n';
  if ([...main.textContent.trim()].length < 200) flags.push('short_content: 可能是短文，也可能是简介、登录墙或JS占位页');
  const type = [item['@type']].flat().join(',');
  const metadata = {
    requested_url: url, canonical_url_hint: doc.querySelector('link[rel="canonical"]')?.href || null,
    title: item.headline || article?.title || meta('og:title') || doc.title || null,
    source: meta('og:site_name') || names(item.publisher)[0] || null,
    author: names(item.author).join('、') || meta('author') || article?.byline || null,
    source_created_at: item.dateCreated || item.datePublished || meta('article:published_time') || meta('datePublished') || null,
    source_type_hint: /ScholarlyArticle/.test(type) ? 'paper' : /BlogPosting/.test(type) ? 'blog' : /VideoObject/.test(type) ? 'video'
      : /TechArticle|APIReference/.test(type) ? 'tech_doc' : /SoftwareSourceCode/.test(type) ? 'project_repo' : /Article/.test(type) ? 'article' : null,
    review_flags: [...new Set(flags)], full_text_confirmed: false
  };
  root?.window.close(); dom.window.close();
  return { markdown, metadata };
}
function localAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (ip.startsWith('::ffff:')) return localAddress(ip.slice(7));
  return ip === '::' || ip === '::1' || /^(fc|fd|fe[89ab])/i.test(ip);
}
async function download(input, hops = 0) {
  assert(hops <= 5, 'too_many_redirects', '网页重定向过多');
  const url = canonicalUrl(input);
  const u = new URL(url);
  const addresses = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true });
  assert(addresses.length && addresses.every(x => !localAddress(x.address)), 'non_public_url', '网页提取仅支持公开网络地址');
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (u.protocol === 'https:' ? https : http).get(u, {
      headers: { 'User-Agent': 'media-keeper/0.1 (personal document archiver)', Accept: 'text/html,text/plain,text/markdown', 'Accept-Encoding': 'identity' },
      lookup: (_, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family)
    }, response => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).href, hops + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new KeeperError('http_error', `网页返回 HTTP ${response.statusCode}，请检查权限或补充全文`)); return; }
      const contentType = String(response.headers['content-type'] || '');
      if (!/text\/(html|plain|markdown)|application\/xhtml\+xml/i.test(contentType)) {
        response.resume(); reject(new KeeperError('unsupported_content', '此提取器只处理HTML/文本；PDF、视频等请使用相应工具获取全文')); return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', data => {
        bytes += data.length;
        if (bytes > 10 * 1024 * 1024) { response.destroy(); reject(new KeeperError('page_too_large', '网页超过10MiB，请分段获取并核对完整性')); }
        else chunks.push(data);
      });
      response.on('error', reject);
      response.on('end', () => {
        const charset = contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
        try { resolve({ url, contentType, text: new TextDecoder(charset).decode(Buffer.concat(chunks)) }); }
        catch { reject(new KeeperError('unsupported_charset', '无法解码网页字符集，请提供UTF-8完整正文')); }
      });
    });
    request.setTimeout(25000, () => request.destroy(new KeeperError('http_timeout', '网页请求超时')));
    request.on('error', reject);
  });
}
export async function main([url, output]) {
  assert(url && output, 'usage', '用法：fetch.mjs URL 输出目录');
  const page = await download(url);
  const isHtml = /html/i.test(page.contentType);
  const result = isHtml ? extractPage(page.text, page.url) : {
    markdown: page.text, metadata: { requested_url: page.url, title: null, source: null, author: null, source_created_at: null,
      source_type_hint: null, review_flags: ['请阅读全文并核对完整性及元数据'], full_text_confirmed: false }
  };
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(output, 'article.md'), result.markdown, { mode: 0o600 });
  await fs.writeFile(path.join(output, isHtml ? 'source.html' : 'source.txt'), page.text, { mode: 0o600 });
  await fs.writeFile(path.join(output, 'metadata.json'), JSON.stringify(result.metadata, null, 2), { mode: 0o600 });
  return { ok: true, directory: path.resolve(output), ...result.metadata };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(x => console.log(JSON.stringify(x))).catch(e => {
    console.error(JSON.stringify({ ok: false, error: { code: e.code || 'fetch_failed', message: e instanceof KeeperError ? e.message : '网页获取失败，请使用其他已授权工具或提供完整内容' } }));
    process.exitCode = 1;
  });
}
