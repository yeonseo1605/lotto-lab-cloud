-- Keep only one active final selection per user and draw.
-- Completed historical batches may all be scored for comparison.
drop index if exists public.one_live_batch_per_draw;

create unique index one_live_batch_per_draw
on public.prediction_batches(user_id, target_draw)
where status in ('locked', 'purchased');
