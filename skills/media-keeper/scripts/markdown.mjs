import { marked } from 'marked';
import { JSDOM } from 'jsdom';

export function markdownText(markdown) {
  const dom = new JSDOM(marked.parse(markdown));
  dom.window.document.querySelectorAll('img,script,style').forEach(el => el.remove());
  const text = dom.window.document.body.textContent.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  dom.window.close();
  return text;
}
export function verifyCopy(expected, actual) {
  const a = markdownText(expected), b = markdownText(actual);
  let i = 0;
  for (const char of b) if (char === a[i]) i++;
  const images = s => (s.match(/!\[[^\]]*\]\(/g) || []).length + (s.match(/<img\b/g) || []).length;
  return { text_complete: Boolean(a.length) && i === a.length, expected_chars: a.length,
    matched_chars: i, expected_images: images(expected), actual_images: images(actual),
    images_complete: images(actual) >= images(expected) };
}
