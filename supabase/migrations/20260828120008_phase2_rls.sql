-- Looty — Phase 2: RLS and grants for blocks, friendships, threads, messages, reports
--
-- Same two-layer approach as Phase 1: RLS decides which rows, grants decide which
-- columns and which verbs. Anything the client must not control simply is not
-- granted, so there is no policy it can satisfy to reach it.

alter table public.blocks      enable row level security;
alter table public.friendships enable row level security;
alter table public.threads     enable row level security;
alter table public.messages    enable row level security;
alter table public.reports     enable row level security;

-- ---------------------------------------------------------------------------
-- Blocks — yours alone, and never revealed to the blocked party
-- ---------------------------------------------------------------------------
--
-- Read is restricted to rows you created. A user must never be able to discover
-- that someone blocked them: blocking is silent, and a query that returns "who
-- blocked me" would undo that completely.

grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

create policy blocks_read_own on public.blocks
  for select to authenticated using (blocker_id = auth.uid());

create policy blocks_insert_own on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());

create policy blocks_delete_own on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Friendships
-- ---------------------------------------------------------------------------

grant select, delete on public.friendships to authenticated;
grant insert (requester_id, addressee_id) on public.friendships to authenticated;
-- Only the status may be updated, and only by the addressee accepting.
grant update (status) on public.friendships to authenticated;

create policy friendships_read_own on public.friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Sending a request needs Tier 1+ (current_tier() folds in the ban check) and no
-- block in either direction.
create policy friendships_insert_own on public.friendships
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and public.current_tier() >= 1
    and not public.is_blocked_pair(requester_id, addressee_id)
  );

-- Only the addressee accepts, and only a pending request. The requester cannot
-- accept on their own behalf.
create policy friendships_accept on public.friendships
  for update to authenticated
  using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');

-- Either side may withdraw, reject, or unfriend — all the same row deletion.
create policy friendships_delete_either on public.friendships
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Threads — created only through open_dm_thread()
-- ---------------------------------------------------------------------------
--
-- No INSERT grant. Clients cannot create threads directly, because a thread is
-- only legitimate if the friendship exists and the pair is stored in canonical
-- order — neither of which a client can be trusted to enforce.

grant select on public.threads to authenticated;

create policy threads_read_own on public.threads
  for select to authenticated
  using (
    (user_a = auth.uid() or user_b = auth.uid())
    and not public.is_blocked_pair(user_a, user_b)
  );

grant execute on function public.open_dm_thread(uuid) to authenticated;
grant execute on function public.is_thread_participant(uuid, uuid) to authenticated;
grant execute on function public.can_post_to_thread(uuid) to authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
--
-- No UPDATE grant: messages are not editable. A report is judged on what was
-- actually sent, and editable history would make every report unfalsifiable.

grant select on public.messages to authenticated;
grant insert (thread_id, sender_id, body, image_url) on public.messages to authenticated;

create policy messages_read_own_threads on public.messages
  for select to authenticated
  using (public.is_thread_participant(thread_id));

-- can_post_to_thread() re-checks participation, tier, ban, block and thread state
-- at send time rather than trusting that any of it held when the thread opened.
create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.can_post_to_thread(thread_id));

-- Senders may delete their own messages. Recipients may not — removing the other
-- side's message would destroy the evidence a report depends on.
grant delete on public.messages to authenticated;
create policy messages_delete_own on public.messages
  for delete to authenticated using (sender_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reports — write-only from the client's point of view
-- ---------------------------------------------------------------------------
--
-- No SELECT policy at all. A user cannot read back reports, not even their own:
-- knowing whether a report landed tells a brigade how close it is to the
-- threshold, and knowing you were reported tells you to switch accounts.
--
-- No UPDATE or DELETE either. Reports are immutable once filed.

grant insert (reporter_id, target_id, context, context_id, reason, detail)
  on public.reports to authenticated;

-- Note there is deliberately NO block check here. Blocking and reporting are the
-- same gesture for someone being harassed — usually block first, then report, or
-- both at once. Refusing reports between blocked users would disable the safety
-- system precisely when it is needed.
create policy reports_insert_eligible on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and public.can_report());

grant execute on function public.can_report() to authenticated;
