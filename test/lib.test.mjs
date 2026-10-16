import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, sourceDate, normalizeRecord, parseTypes, verifyCopy } from '../scripts/lib.mjs';
import { extractPage } from '../scripts/fetch.mjs';

const types = ['article','paper','blog','video','tech_doc','project_repo'];
const base = { title: '测试', abstract: '核心结论。', source: '测试站', source_type: 'article', link: 'https://example.org/A?id=1' };
test('abstract limit counts Unicode code points without cutting sentences', () => {
  assert.equal(normalizeRecord({ ...base, abstract: '好' }, types).record.abstract, '好');
  assert.equal([...normalizeRecord({ ...base, abstract: '😀'.repeat(400) }, types).record.abstract].length, 400);
  assert.throws(() => normalizeRecord({ ...base, abstract: '好'.repeat(401) }, types), /400/);
});
test('type and full-text entrypoint are validated', () => {
  for (const type of types) assert.equal(normalizeRecord({ ...base, source_type: type }, types).record.source_type, type);
  assert.throws(() => normalizeRecord({ ...base, source_type: 'unknown' }, types), /source_type/);
  assert.throws(() => normalizeRecord({ ...base, link: null }, types), e => e.code === 'missing_full_text');
  assert.throws(() => normalizeRecord({ ...base, copied_lark_link: 'https://evil.test/docx/a' }, types), /copied_lark_link/);
});
test('unknown author remains null and author order is retained', () => {
  assert.equal(normalizeRecord(base, types).record.author, null);
  assert.equal(normalizeRecord({ ...base, author: ['甲', '乙'] }, types).record.author, '甲、乙');
});
test('source dates normalize to UTC with microseconds and never invent an unknown time', () => {
  assert.equal(sourceDate('2026-10-16').value, '2026-10-15 16:00:00.000000');
  assert.equal(sourceDate('2026-10-16T10:20:30.123456+08:00').value, '2026-10-16 02:20:30.123456');
  assert.equal(sourceDate('2026-10-16 10:20:30').value, '2026-10-16 02:20:30.000000');
  for (const d of [null, '', '2026', '2026-10', '2026-02-30', '昨天']) assert.equal(sourceDate(d).value, null);
});
test('URLs retain semantic queries and SPA routes while rejecting credentials', () => {
  assert.equal(canonicalUrl('https://EXAMPLE.org/A?utm_source=x&id=1#heading'), 'https://example.org/A?id=1');
  assert.equal(canonicalUrl('https://example.org/#/docs/2'), 'https://example.org/#/docs/2');
  for (const url of ['https://example.org/?access_token=x','https://example.org/?X-Amz-Signature=x','https://u:p@example.org','file:///etc/passwd']) assert.throws(() => canonicalUrl(url));
});
test('enum values are discovered from the database definition, including future additions', () => {
  assert.deepEqual(parseTypes("enum('article','paper','blog','video','tech_doc','project_repo','book')"), [...types,'book']);
});
test('copy verification catches missing trailing conclusions and missing images', () => {
  const expected = '# 标题\n正文结论42。\n\n![图](https://example.org/a.png)\n\n最后限制是只支持Linux。';
  assert.equal(verifyCopy(expected, '# 多余标题\n' + expected).text_complete, true);
  assert.equal(verifyCopy(expected, '# 标题\n正文结论42。').text_complete, false);
  assert.equal(verifyCopy(expected, expected.replace(/!\[图\]\([^)]*\)/, '')).images_complete, false);
});
test('HTML extraction retains tail, code, table and explicit metadata without executing scripts', () => {
  const html = `<html><head><title>测试文档</title><meta property="og:site_name" content="示例站"><script type="application/ld+json">{"@type":"BlogPosting","author":[{"name":"甲"},{"name":"乙"}],"datePublished":"2026-10-16","dateModified":"2026-11-01"}</script></head><body><article><h1>测试文档</h1><p>${'这里介绍正文，说明方法及依据。'.repeat(30)}</p><pre><code>const x = '&lt;tag&gt;';</code></pre><table><thead><tr><th>名称</th><th>值</th></tr></thead><tbody><tr><td>结果</td><td>42</td></tr></tbody></table><p>最终结论：需人工核验；不适合医疗决策。</p></article></body></html>`;
  const r = extractPage(html, 'https://example.org/a');
  assert.match(r.markdown, /最终结论/); assert.match(r.markdown, /const x/); assert.match(r.markdown, /42/);
  assert.equal(r.metadata.source, '示例站'); assert.equal(r.metadata.author, '甲、乙');
  assert.equal(r.metadata.source_created_at, '2026-10-16'); assert.equal(r.metadata.source_type_hint, 'blog');
  assert.equal(r.metadata.full_text_confirmed, false);
});
test('a modified timestamp alone is not treated as creation time', () => {
  const r = extractPage('<html><head><meta property="article:modified_time" content="2026-10-16"></head><body><main>一条简短说明。</main></body></html>', 'https://example.org');
  assert.equal(r.metadata.source_created_at, null); assert.ok(r.metadata.review_flags.length);
});
test('technical reference and code repository metadata have distinct type hints', () => {
  for (const [kind, expected] of [['TechArticle','tech_doc'], ['APIReference','tech_doc'], ['SoftwareSourceCode','project_repo']]) {
    const r = extractPage(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': kind, headline: '参考资料' })}</script></head><body><main>这是技术参考或项目仓库说明。</main></body></html>`, 'https://example.org/reference');
    assert.equal(r.metadata.source_type_hint, expected);
  }
});
