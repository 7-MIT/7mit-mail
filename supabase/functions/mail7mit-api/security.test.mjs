import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encrypt,decrypt,publicAddress,resolveHost} from './security.mjs';
test('AES-GCM preserves credentials and rejects tampering and the wrong key',()=>{const key=randomBytes(32),data={password:'private-app-password',username:'you@example.com'};const encrypted=encrypt(data,key);assert.deepEqual(decrypt(encrypted,key),data);assert.ok(!encrypted.includes(data.password));assert.throws(()=>decrypt(encrypted,randomBytes(32)));const changed=Buffer.from(encrypted,'base64');changed[15]^=1;assert.throws(()=>decrypt(changed.toString('base64'),key));assert.notEqual(encrypt(data,key),encrypted)});
test('mail server guard blocks loopback, LAN, metadata, mapped addresses and transition tunnels',()=>{for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','64:ff9b::a00:1','2002:a00:1::'])assert.equal(publicAddress(ip),false,ip);assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true)});
test('host guard rejects malformed and nonpublic hosts',async()=>{for(const host of ['localhost','http://example.com','host..example.com','127.0.0.1'])await assert.rejects(()=>resolveHost(host))});
