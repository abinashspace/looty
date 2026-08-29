/**
 * Shown while an account is restricted.
 *
 * Bans are issued automatically with no human review, so this screen has two jobs:
 * say plainly what happened and when it lifts, and make appealing easy. The appeal
 * queue is the only place a person looks at a moderation decision.
 *
 * A ban is not a logout. Reading groups still works, and the way back to them stays
 * visible — a restricted user is still a student.
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { Body, Button, LinkButton, Notice, Screen, Title } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Ban = { id: string; type: 'temporary' | 'permanent'; ends_at: string | null; reason: string | null };
type Appeal = { id: string; status: 'pending' | 'upheld' | 'overturned' };

export default function Banned() {
  const { session, signOut, refresh } = useSession();
  const router = useRouter();
  const c = useTheme();

  const [ban, setBan] = useState<Ban | null>(null);
  const [appeal, setAppeal] = useState<Appeal | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: bans } = await supabase
      .from('bans')
      .select('id, type, ends_at, reason')
      .order('created_at', { ascending: false })
      .limit(1);

    const current = (bans as Ban[])?.[0] ?? null;
    setBan(current);

    if (current) {
      const { data: appeals } = await supabase
        .from('appeals')
        .select('id, status')
        .eq('ban_id', current.id)
        .maybeSingle();
      setAppeal((appeals as Appeal) ?? null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!ban || !session?.user.id) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase
      .from('appeals')
      .insert({ ban_id: ban.id, user_id: session.user.id, body: body.trim() });

    if (err) {
      setError(
        err.code === '23505'
          ? 'You have already appealed this. We will get to it.'
          : err.message,
      );
    } else {
      setBody('');
      await load();
    }
    setBusy(false);
  }

  const until = ban?.ends_at
    ? new Date(ban.ends_at).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
      })
    : null;

  return (
    <Screen>
      <Title>Your account is restricted</Title>

      <Body>
        {ban?.type === 'permanent'
          ? 'This restriction does not expire. You can still read the groups.'
          : until
            ? `You can post again on ${until}. Until then you can still read the groups.`
            : 'You can still read the groups while this is in place.'}
      </Body>

      <Notice>
        Restrictions are applied automatically when enough people report an account.
        If that was wrong, tell us below — a person reads every appeal.
      </Notice>

      {appeal ? (
        <Notice tone={appeal.status === 'upheld' ? 'error' : 'info'}>
          {appeal.status === 'pending'
            ? 'Your appeal is in the queue. We usually get to these within a few days.'
            : appeal.status === 'overturned'
              ? 'Your appeal was accepted. Try reopening the app.'
              : 'Your appeal was reviewed and the restriction stands.'}
        </Notice>
      ) : (
        <>
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            placeholder="What happened, in your words."
            placeholderTextColor={c.textSecondary}
            maxLength={2000}
            style={{
              minHeight: 120,
              borderWidth: 1,
              borderRadius: 10,
              padding: 14,
              fontSize: 16,
              textAlignVertical: 'top',
              color: c.text,
              backgroundColor: c.backgroundElement,
              borderColor: c.border,
            }}
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button
            label="Send appeal"
            onPress={submit}
            loading={busy}
            disabled={body.trim().length < 10}
          />
        </>
      )}

      <View style={{ alignItems: 'center', gap: 14, paddingTop: 8 }}>
        <LinkButton
          label="Read groups"
          onPress={async () => {
            await refresh();
            router.replace('/(app)/groups');
          }}
        />
        <LinkButton label="Sign out" onPress={signOut} />
      </View>
    </Screen>
  );
}
