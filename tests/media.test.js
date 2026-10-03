// Медиа и вложения заметок (обновление 0.5): типы, ссылки, сборка мусора, слияние вложений, «Отменить».

import { test, assert } from './runner.js';
import { makeCtx, makeData, addTask } from './helpers.js';
import { kindOf, extOf, formatBytes, formatDuration, mediaRefs, gcPlan, pendingUploads } from '../src/core/media.js';
import { addNote, addAttachment, removeAttachment, moveAttachment, liveAttachments, liveNotes, newMedia, revert, tombstone, duplicateTask } from '../src/core/model.js';
import { mergeEntity } from '../src/core/merge.js';
import { crc32, makeZip } from '../src/data/exportZip.js';

const SHA = (ch) => ch.repeat(64);
const NOW = Date.parse('2026-10-03T12:00:00.000Z');

function withNote() {
  const c = makeCtx(NOW);
  const d = makeData();
  let t = addTask(d, c, { title: 'A' });
  t = addNote(t, 'текст', 'a0', c);
  d.tasks.set(t.id, t);
  return { c, d, t, noteId: liveNotes(t)[0].id };
}

test('kindOf / extOf / formatBytes / formatDuration', () => {
  assert.equal(kindOf('image/webp'), 'image');
  assert.equal(kindOf('audio/webm;codecs=opus'), 'audio');
  assert.equal(kindOf('video/mp4'), 'video');
  assert.equal(kindOf('application/pdf'), 'file');
  assert.equal(extOf('audio/webm;codecs=opus'), 'webm');
  assert.equal(extOf('', 'Отчёт.DOCX'), 'docx');
  assert.equal(extOf('application/x-unknown', 'noext'), 'bin');
  assert.equal(formatBytes(512), '512 Б');
  assert.equal(formatBytes(1536), '1,5 КБ');
  assert.equal(formatBytes(150 * 1024 * 1024), '150 МБ');
  assert.equal(formatDuration(42000), '0:42');
  assert.equal(formatDuration(3723000), '1:02:03');
});

test('вложения заметки: добавить, переставить, удалить, «Отменить» удаления', () => {
  const { c, t, noteId } = withNote();
  let x = addAttachment(t, noteId, { mediaId: SHA('a'), name: 'фото.webp' }, c);
  x = addAttachment(x, noteId, { mediaId: SHA('b'), name: 'голос.webm' }, c);
  let atts = liveAttachments(liveNotes(x)[0]);
  assert.deepEqual(atts.map((a) => a.name), ['фото.webp', 'голос.webm']);
  x = moveAttachment(x, noteId, atts[1].id, 'Zz', c);
  assert.deepEqual(liveAttachments(liveNotes(x)[0]).map((a) => a.name), ['голос.webm', 'фото.webp']);
  const before = x;
  const del = removeAttachment(x, noteId, atts[0].id, c);
  assert.equal(liveAttachments(liveNotes(del)[0]).length, 1);
  const restored = revert(del, before, c);
  assert.equal(liveAttachments(liveNotes(restored)[0]).length, 2, '«Отменить» возвращает вложение');
  // Метка восстановленного вложения новее удаления — после слияния с удалением оно остаётся
  const merged = mergeEntity(del, restored);
  assert.equal(liveAttachments(liveNotes(merged)[0]).length, 2);
});

test('слияние: вложения одной заметки с двух устройств сохраняются оба, удаление побеждает по метке', () => {
  const { c, t, noteId } = withNote();
  const cB = { ...makeCtx(NOW + 10), deviceId: 'devB' };
  const a = addAttachment(t, noteId, { mediaId: SHA('a'), name: 'с телефона.webp' }, c);
  const b = addAttachment(t, noteId, { mediaId: SHA('b'), name: 'с компа.pdf' }, cB);
  const m = mergeEntity(a, b);
  assert.deepEqual(liveAttachments(liveNotes(m)[0]).map((x) => x.name).sort(), ['с компа.pdf', 'с телефона.webp']);
  assert.equal(liveNotes(m)[0].text, 'текст');
  const aDel = removeAttachment(m, noteId, liveAttachments(liveNotes(m)[0]).find((x) => x.name === 'с телефона.webp').id, makeCtx(NOW + 100));
  const m2 = mergeEntity(aDel, m);
  assert.deepEqual(liveAttachments(liveNotes(m2)[0]).map((x) => x.name), ['с компа.pdf']);
  assert.equal(JSON.stringify(mergeEntity(m2, aDel)), JSON.stringify(m2), 'идемпотентно');
});

test('ссылки на медиа и сборка мусора: сирота отмечается, через срок — удаляется; снова нужна — снимается', () => {
  const { c, d, t, noteId } = withNote();
  for (const id of [SHA('a'), SHA('b')]) d.media.set(id, newMedia({ id, kind: 'image', mime: 'image/webp', ext: 'webp', size: 100 }, c));
  const x = addAttachment(t, noteId, { mediaId: SHA('a'), name: 'a.webp' }, c);
  d.tasks.set(x.id, x);
  assert.deepEqual([...mediaRefs(d)], [SHA('a')]);
  assert.deepEqual(pendingUploads(d).map((m) => m.id), [SHA('a')], 'не залитые и нужные');
  let plan = gcPlan(d, NOW, 30);
  assert.deepEqual(plan.mark, [SHA('b')]);
  d.media.set(SHA('b'), { ...d.media.get(SHA('b')), orphanedAt: new Date(NOW - 31 * 86400000).toISOString() });
  plan = gcPlan(d, NOW, 30);
  assert.deepEqual(plan.expire.map((m) => m.id), [SHA('b')]);
  // Задача удалена навсегда — её медиа становятся сиротами; в корзине — нет
  d.tasks.set(x.id, { ...x, trashedAt: new Date(NOW).toISOString() });
  assert.ok(mediaRefs(d).has(SHA('a')), 'задача в корзине ссылается');
  d.tasks.set(x.id, tombstone(x, c));
  assert.ok(!mediaRefs(d).has(SHA('a')));
  d.media.set(SHA('a'), { ...d.media.get(SHA('a')), orphanedAt: new Date(NOW).toISOString() });
  d.tasks.set(x.id, x);
  assert.deepEqual(gcPlan(d, NOW, 30).unmark, [SHA('a')]);
});

test('«Дублировать» копирует заметки вместе с голосовой без текста и ссылками на те же медиа', () => {
  const { c, t, noteId } = withNote();
  let x = addAttachment(t, noteId, { mediaId: SHA('a'), name: 'a.webp' }, c);
  x = addNote(x, '', 'a1', c);
  const voiceNote = liveNotes(x).find((n) => n.text === '');
  x = addAttachment(x, voiceNote.id, { mediaId: SHA('c'), name: 'голос.webm' }, c);
  const copy = duplicateTask(x, 'a5', makeCtx(NOW + 50));
  const notes = liveNotes(copy);
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map((n) => liveAttachments(n).map((a) => a.mediaId)), [[SHA('a')], [SHA('c')]]);
});

test('zip: CRC-32 эталона, записи STORE читаются по центральному каталогу, имена в UTF-8', async () => {
  const enc = new TextEncoder();
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  const files = [{ name: 'export.json', bytes: enc.encode('{"a":1}'), deflate: true }, { name: 'media/фото.webp', bytes: new Uint8Array([1, 2, 3, 4, 5]) }];
  const zip = new Uint8Array(await (await makeZip(files)).arrayBuffer());
  const dv = new DataView(zip.buffer);
  const eocd = zip.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 2);
  let p = dv.getUint32(eocd + 16, true);
  const names = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nlen));
    names.push(name);
    const lnlen = dv.getUint16(off + 26, true);
    const data = zip.subarray(off + 30 + lnlen, off + 30 + lnlen + csize);
    const src = files.find((f) => f.name === name);
    if (method === 0) assert.deepEqual([...data], [...src.bytes]);
    assert.equal(crc, crc32(src.bytes));
    p += 46 + nlen;
  }
  assert.deepEqual(names, ['export.json', 'media/фото.webp']);
});