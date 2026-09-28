create extension if not exists pgcrypto;

create table public.lotto_draws (
  draw_no integer primary key check (draw_no > 0),
  draw_date date not null,
  numbers smallint[] not null check (cardinality(numbers) = 6),
  bonus smallint not null check (bonus between 1 and 45),
  source text not null default 'dhlottery.co.kr',
  synced_at timestamptz not null default now()
);

create table public.strategy_evaluations (
  history_end integer primary key references public.lotto_draws(draw_no),
  evaluated integer not null,
  random_average numeric not null,
  predictive_average numeric not null,
  mean_difference numeric not null,
  ci_low numeric not null,
  ci_high numeric not null,
  p_value numeric not null,
  recommended text not null check (recommended in ('randomCoverage','predictiveCoverage')),
  reason text not null,
  model_version text not null,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget integer not null default 50000 check (monthly_budget >= 0),
  max_generation_attempts smallint not null default 3 check (max_generation_attempts between 1 and 3),
  updated_at timestamptz not null default now()
);

create table public.prediction_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_draw integer not null check (target_draw > 0),
  status text not null default 'preview' check (status in ('preview','locked','purchased','scored','expired','cancelled')),
  strategy_requested text not null default 'validated-auto',
  strategy_used text not null check (strategy_used in ('randomCoverage','predictiveCoverage')),
  reason text not null,
  seed text not null,
  model_version text not null,
  history_end integer not null,
  attempt_no smallint not null check (attempt_no between 1 and 3),
  max_attempts smallint not null check (max_attempts between 1 and 3),
  content_hash text not null,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  scored_at timestamptz,
  best_matches smallint,
  best_prize smallint
);

create table public.prediction_tickets (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.prediction_batches(id) on delete cascade,
  ticket_no smallint not null check (ticket_no between 1 and 5),
  numbers smallint[] not null check (cardinality(numbers) = 6),
  matches smallint,
  prize smallint,
  unique(batch_id, ticket_no)
);

create unique index one_live_batch_per_draw on public.prediction_batches(user_id,target_draw)
where status in ('locked','purchased','scored');

create table public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_draw integer not null,
  batch_id uuid references public.prediction_batches(id) on delete set null,
  games smallint not null check (games > 0),
  cost integer not null check (cost >= 0),
  payout bigint not null default 0 check (payout >= 0),
  purchased_at date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

alter table public.lotto_draws enable row level security;
alter table public.strategy_evaluations enable row level security;
alter table public.user_settings enable row level security;
alter table public.prediction_batches enable row level security;
alter table public.prediction_tickets enable row level security;
alter table public.purchases enable row level security;

create policy "draws readable after login" on public.lotto_draws for select to authenticated using (true);
create policy "evaluations readable after login" on public.strategy_evaluations for select to authenticated using (true);
create policy "own settings read" on public.user_settings for select using (auth.uid()=user_id);
create policy "own settings insert" on public.user_settings for insert with check (auth.uid()=user_id);
create policy "own settings update" on public.user_settings for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own batches read" on public.prediction_batches for select using (auth.uid()=user_id);
create policy "own tickets read" on public.prediction_tickets for select using (exists(select 1 from public.prediction_batches b where b.id=batch_id and b.user_id=auth.uid()));
create policy "own purchases read" on public.purchases for select using (auth.uid()=user_id);
create policy "own purchases insert" on public.purchases for insert with check (auth.uid()=user_id);
create policy "own purchases update" on public.purchases for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own purchases delete" on public.purchases for delete using (auth.uid()=user_id);

create index batches_user_draw on public.prediction_batches(user_id,target_draw,created_at desc);
create index purchases_user_date on public.purchases(user_id,purchased_at desc);

grant select on public.lotto_draws, public.strategy_evaluations to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant select on public.prediction_batches, public.prediction_tickets to authenticated;
grant select, insert, update, delete on public.purchases to authenticated;
grant all on public.lotto_draws, public.strategy_evaluations, public.user_settings,
  public.prediction_batches, public.prediction_tickets, public.purchases to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

