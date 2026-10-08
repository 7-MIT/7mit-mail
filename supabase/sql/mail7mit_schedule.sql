-- Provision once in a new installation. Already provisioned on server.7mit.
insert into public.mail7mit_keys(id,secret)
values ('credentials_v1',encode(extensions.gen_random_bytes(32),'base64')) on conflict(id) do nothing;
insert into public.mail7mit_sync_secret(id,secret)
values (true,encode(extensions.gen_random_bytes(32),'hex')) on conflict(id) do nothing;
select cron.schedule('mail7mit-background-sync','*/2 * * * *',$job$
 select net.http_post(
  url:='https://lajzrempjyoqkubkumhb.supabase.co/functions/v1/mail7mit-api',
  headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object('action','backgroundSync','syncToken',(select secret from public.mail7mit_sync_secret where id=true)),
  timeout_milliseconds:=120000
 );
$job$);
