// Lets the Deno-style function (npm: imports, Deno global) load under Node for tests, with network/DB replaced by fakes.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const url = (f) => ({ url: pathToFileURL(path.join(here, f)).href, shortCircuit: true });
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('npm:@supabase/supabase-js')) return url('fake-supabase.mjs');
  if (spec.startsWith('npm:imapflow') || spec.startsWith('npm:mailparser')) return url('fake-mail-libs.mjs');
  if (spec.startsWith('npm:nodemailer@') && spec.includes('mail-composer')) return url('fake-composer.mjs');
  if (spec.startsWith('npm:nodemailer')) return url('fake-nodemailer.mjs');
  if (spec === './security.mjs') return url('fake-security.mjs');
  return next(spec, ctx);
}
