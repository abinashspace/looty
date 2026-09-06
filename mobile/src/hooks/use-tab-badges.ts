import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { subscribeBadges } from '@/lib/badges';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { can } from '@/lib/tiers';

function badge(n: number): number | undefined {
  return n > 0 ? n : undefined;
}

export function useTabBadges() {
  const { session, tier, isBanned } = useSession();
  const [chats, setChats] = useState<number | undefined>();
  const [looted, setLooted] = useState<number | undefined>();
  const [groups, setGroups] = useState<number | undefined>();

  const load = useCallback(async () => {
    if (!session) {
      setChats(undefined);
      setLooted(undefined);
      setGroups(undefined);
      return;
    }

    const chatOk = can('directMessage', tier, isBanned);
    const matchOk = can('lootyMatch', tier, isBanned);

    const groupOk = can('postInGroups', tier, isBanned);

    const [{ data: threads }, { data: reqs }, { data: n }, { data: invites }] = await Promise.all([
      chatOk ? supabase.rpc('my_threads') : Promise.resolve({ data: [] as unknown[] }),
      chatOk ? supabase.rpc('my_friend_requests') : Promise.resolve({ data: [] as unknown[] }),
      matchOk ? supabase.rpc('looted_you_count') : Promise.resolve({ data: 0 }),
      groupOk ? supabase.rpc('my_group_invites') : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const unread = ((threads as { unread?: boolean }[] | null) ?? []).filter((t) => t.unread).length;
    const incoming = ((reqs as { direction?: string }[] | null) ?? []).filter(
      (r) => r.direction === 'incoming',
    ).length;
    const lootN = typeof n === 'number' ? n : Number(n ?? 0);

    setChats(badge(unread + incoming));
    setLooted(badge(Number.isFinite(lootN) ? lootN : 0));
    // A group invitation is the only thing that needs answering here — being in
    // a busy group is not a notification, which is why unread counts stay out.
    setGroups(badge(((invites as unknown[] | null) ?? []).length));
  }, [session, tier, isBanned]);

  useEffect(() => {
    void load();
    const unsub = subscribeBadges(() => {
      void load();
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load();
    });
    const channel = supabase
      .channel('tab-badges')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_invites' },
        () => load(),
      )
      .subscribe();
    return () => {
      unsub();
      app.remove();
      supabase.removeChannel(channel);
    };
  }, [load]);

  return { chats, looted, groups };
}
