import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encrypt, decrypt, hashPassword, verifyPassword, loadMasterKey } from '../server/crypto.js';
import { assertPublicHost } from '../server/netguard.js';
import { cleanHtml } from '../server/mail.js';

const key = crypto.randomBytes(32);

test('AES-GCM roundtrip and tamper detection', () => {
  const blob = encrypt('p@ss word', key);
  assert.ok(!blob.includes('p@ss'));
  assert.equal(decrypt(blob, key), 'p@ss word');
  assert.notEqual(encrypt('x', key), encrypt('x', key));
  const parts = blob.split('.'); parts[3] = Buffer.from('garbage').toString('base64');
  assert.throws(() => decrypt(parts.join('.'), key));
  assert.throws(() => decrypt(blob, crypto.randomBytes(32)));
});

test('master key validation', () => {
  assert.throws(() => loadMasterKey(''));
  assert.throws(() => loadMasterKey('c2hvcnQ='));
  assert.equal(loadMasterKey(key.toString('base64')).length, 32);
  assert.equal(loadMasterKey(key.toString('hex')).length, 32);
});

test('password hashing', () => {
  const h = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('SSRF guard rejects private targets', async () => {
  for (const h of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '169.254.169.254', '172.16.0.1', '::1', 'localhost', '::ffff:127.0.0.1'])
    await assert.rejects(() => assertPublicHost(h, false), /non-public/, h);
  await assert.rejects(() => assertPublicHost('a b', false), /Invalid/);
  await assertPublicHost('127.0.0.1', true);
  await assertPublicHost('8.8.8.8', false);
});

test('HTML sanitizer strips active content and blocks remote images', () => {
  const dirty = `<p onclick="x()">hi</p><script>alert(1)</script><iframe src="http://e"></iframe>
    <a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a>
    <img src="https://track.example/p.gif"><img src="cid:logo@x"><form action="/x"><input></form>
    <div style="background:url(javascript:1);color:red">s</div>`;
  const { html, blockedImages } = cleanHtml(dirty, { cidMap: { 'logo@x': '/att/0?inline=1' } });
  assert.ok(!/script|onclick|iframe|javascript:|<form|<input|url\(/i.test(html), html);
  assert.ok(!/\ssrc="https:\/\/track/.test(html));
  assert.ok(html.includes('data-blocked-src="https://track.example/p.gif"'));
  assert.ok(html.includes('src="/att/0?inline=1"'));
  assert.ok(html.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(html.includes('color:red'));
  assert.equal(blockedImages, 1);
  assert.ok(cleanHtml('<img src="https://t.example/x.gif">', { remoteImages: true }).html.includes('src="https://t.example/x.gif"'));
});
