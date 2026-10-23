import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaQuery, dayBounds, publishedBounds, serializeMediaRecord } from '../index.mjs';
test('calendar-day filters use Shanghai midnight and an exclusive UTC end', () => {
  assert.deepEqual(dayBounds('2026-10-23'), { dayStart: '2026-10-22 16:00:00', dayEnd: '2026-10-23 16:00:00' });
  assert.deepEqual(dayBounds('2024-02-29'), { dayStart: '2024-02-28 16:00:00', dayEnd: '2024-02-29 16:00:00' });
  for (const day of ['2026-02-29','2026-10','2026-10-23T00:00:00Z','2026-13-01','0999-01-01','9999-12-31']) {
    assert.throws(() => dayBounds(day), error => error.code === 'invalid_query');
  }
});
test('query validation rejects ambiguous, unbounded and unknown values', () => {
  for (const input of [{ title: ['a','b'] },{ source_type: 'unknown' },{ page:'0' },{ page:'1.5' },{ page:'1e2' },
    { page_size:'101' },{ page:'1000001' },{ source_created_at:'2026-02-30' },{ sort_by:'id; DROP TABLE useful_docs' },
    { sort_order:'DESC' },{ extra:'x' },{ author:'a'.repeat(513) }]) {
    assert.throws(() => parseMediaQuery(input), error => error.code === 'invalid_query');
  }
  assert.deepEqual(parseMediaQuery({ title:'  ', source_type:'', source_created_at:'' }),
    { page:1, page_size:20, sort_by:'created_at', sort_order:'desc' });
  assert.equal(parseMediaQuery({ title:'  A_%  ' }).title,'A_%');
});
test('API serialization preserves bigint IDs, null values and microseconds', () => {
  const row={ id:'18446744073709551615',source_created_at:null,created_at:'2026-10-23 01:02:03.123456',updated_at:'2026-10-23 01:02:03.123456' };
  const actual=serializeMediaRecord(row);
  assert.equal(actual.id,row.id); assert.equal(actual.source_created_at,null);
  assert.equal(actual.created_at,'2026-10-23T01:02:03.123456Z');
  assert.equal(row.created_at,'2026-10-23 01:02:03.123456');
});

test('publication presets include today in Shanghai, handle month/leap boundaries and reject conflicts', () => {
  const now = new Date('2024-02-29T04:00:00Z');
  assert.deepEqual(publishedBounds('today', now), { dayStart: '2024-02-28 16:00:00', dayEnd: '2024-02-29 16:00:00' });
  assert.deepEqual(publishedBounds('week', now), { dayStart: '2024-02-22 16:00:00', dayEnd: '2024-02-29 16:00:00' });
  assert.deepEqual(publishedBounds('month', now), { dayStart: '2024-01-31 16:00:00', dayEnd: '2024-02-29 16:00:00' });
  assert.deepEqual(publishedBounds('year', now), { dayStart: '2023-02-28 16:00:00', dayEnd: '2024-02-29 16:00:00' });
  assert.deepEqual(publishedBounds('all', now), {});
  assert.deepEqual(publishedBounds('today', new Date('2026-10-23T16:00:00Z')), { dayStart:'2026-10-23 16:00:00', dayEnd:'2026-10-24 16:00:00' });
  assert.throws(() => parseMediaQuery({ published: 'yesterday' }), error => error.code === 'invalid_query');
  assert.throws(() => parseMediaQuery({ published: 'all', source_created_at: '2024-02-29' }), error => error.code === 'invalid_query');
});
