-- RLS 정책은 그대로 유지하면서 앱과 Edge Functions에 필요한 테이블 권한만 부여합니다.
grant select on public.lotto_draws, public.strategy_evaluations to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant select on public.prediction_batches, public.prediction_tickets to authenticated;
grant select, insert, update, delete on public.purchases to authenticated;
grant all on public.lotto_draws, public.strategy_evaluations, public.user_settings,
  public.prediction_batches, public.prediction_tickets, public.purchases to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

