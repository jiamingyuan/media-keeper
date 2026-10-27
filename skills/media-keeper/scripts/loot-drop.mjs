import { assert } from '@media-keeper/core';

export function isLootDropReportUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      ['loot-drop.io', 'www.loot-drop.io'].includes(url.hostname) && /^\/startup\/[^/]+\/?$/.test(url.pathname);
  } catch { return false; }
}

// The modal body is stored in an attribute, not in the visible preview text.
// Work on the original DOM: Readability otherwise discards report sections.
export function expandLootDropReport(doc) {
  const main = doc.querySelector('main');
  const cards = [...(main?.querySelectorAll('.shutdown-grid .grid-card') || [])];
  const expected = ['Failure Analysis', 'Market Analysis', 'Startup Learnings', 'Market Potential', 'Difficulty', 'Scalability'];
  const sections = cards.map(card => ({ title: card.querySelector('.card-title')?.textContent.trim(),
    text: card.getAttribute('data-full-text')?.trim() }));
  const incomplete = () => assert(false, 'loot_drop_incomplete',
    'Loot Drop 报告结构或展开正文缺失，请用浏览器逐项展开核对，不能用短预览冒充全文');
  if (!main?.querySelector('.hero-story') || !main.querySelector('.stats-bar') ||
      expected.some(title => !sections.some(s => s.title === title)) || sections.some(s => !s.title || !s.text) ||
      !main.querySelector('.master-timeline-section .master-stage-body')) incomplete();
  for (const [index, card] of cards.entries()) {
    const heading = doc.createElement('h3'); heading.textContent = sections[index].title;
    const body = doc.createElement('p'); body.textContent = sections[index].text;
    card.replaceChildren(heading, body);
  }
  const stats = main.querySelector('.stats-bar');
  const table = doc.createElement('table');
  const header = table.createTHead().insertRow();
  for (const label of ['Category', 'Value']) { const th = doc.createElement('th'); th.textContent = label; header.append(th); }
  const rows = table.createTBody();
  for (const stat of stats.querySelectorAll('.stat-box')) {
    const label = stat.querySelector('.stat-label')?.textContent.trim();
    const value = stat.querySelector('.stat-value')?.textContent.trim();
    if (!label || !value) incomplete();
    const row = rows.insertRow(); row.insertCell().textContent = label; row.insertCell().textContent = value;
  }
  if (!rows.rows.length) incomplete();
  stats.replaceWith(table);
  const tech = main.querySelector('.tech-tags');
  if (tech) {
    const list = doc.createElement('ul');
    for (const tag of tech.querySelectorAll('.tech-tag')) { const li = doc.createElement('li'); li.textContent = tag.textContent; list.append(li); }
    tech.replaceWith(list);
  }
  // Related cards navigate via data-href rather than ordinary anchor elements.
  for (const card of main.querySelectorAll('.related-section [data-href]')) {
    const name = card.querySelector('.card-v2-name')?.textContent.trim();
    const target = new URL(card.getAttribute('data-href'), doc.URL).href;
    assert(name && isLootDropReportUrl(target), 'loot_drop_incomplete', '相关案例缺少可核对的公司名或原文链接');
    const p = doc.createElement('p'); const a = doc.createElement('a');
    a.textContent = name; a.href = target; p.append(a); card.replaceWith(p);
  }
  main.querySelectorAll('button,.expand-toggle,.master-timeline-marker-col,.timeline-marker-col,.graveyard-cta-wrapper').forEach(el => el.remove());
  return { main, sections: sections.map(s => ({ title: s.title, characters: [...s.text].length })) };
}
