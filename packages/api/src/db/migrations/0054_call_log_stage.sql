-- Record which stage of the script a call used.
--
-- Without this the end-of-cycle report can count calls but cannot say what any
-- given number actually heard — and "did they hear the Columbus pitch or just
-- the profile pitch" is the difference between a market worth calling again and
-- one worth mailing instead. The stage was being computed at dial time and then
-- thrown away.

alter table campaign_call_logs
  add column if not exists touch_number integer;

-- Backfill: before today the stage WAS the dial number, so the nth call to a
-- lead was stage n. True by construction for every historical row.
with ordered as (
  select id,
         row_number() over (partition by lead_id order by created_at) as n
    from campaign_call_logs
   where lead_id is not null
     and direction = 'OUTBOUND'
)
update campaign_call_logs l
   set touch_number = ordered.n
  from ordered
 where l.id = ordered.id
   and l.touch_number is null;

create index if not exists campaign_call_logs_stage_idx
  on campaign_call_logs (campaign_id, touch_number);
