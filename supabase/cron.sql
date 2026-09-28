-- Edge Function 배포 후 URL, publishable key, CRON_SECRET을 Supabase Vault에 저장한 다음 실행합니다.
select vault.create_secret('https://YOUR_PROJECT.supabase.co', 'project_url');
select vault.create_secret('YOUR_PUBLISHABLE_KEY', 'publishable_key');
select vault.create_secret('A_LONG_RANDOM_SECRET', 'cron_secret');

select cron.schedule(
  'sync-lotto-every-saturday',
  '15 12 * * 6', -- UTC 12:15 = 한국 토요일 21:15
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/sync-draws',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

