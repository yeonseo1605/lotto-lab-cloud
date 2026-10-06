-- Edge Function 배포 후 실제 값을 Vault에 저장한 다음 한 번 실행합니다.
select vault.create_secret('https://YOUR_PROJECT.supabase.co', 'project_url');
select vault.create_secret('YOUR_PUBLISHABLE_KEY', 'publishable_key');
select vault.create_secret('A_LONG_RANDOM_SECRET', 'cron_secret');

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('sync-lotto-every-saturday','sync-lotto-saturday-retry','sync-lotto-sunday-fallback');
exception when others then null;
end $$;

-- 한국 토요일 21:10~23:50, 10분마다 확인. 결과 게시 전 호출은 무해하다.
select cron.schedule('sync-lotto-saturday-retry','10-59/10 12-14 * * 6',$$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/sync-draws',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  );
$$);

-- 토요일 API 장애나 지연에 대비한 일요일 09:05(KST) 최종 보정.
select cron.schedule('sync-lotto-sunday-fallback','5 0 * * 0',$$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/sync-draws',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='publishable_key'),'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  );
$$);
