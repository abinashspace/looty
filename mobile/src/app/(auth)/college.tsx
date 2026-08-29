/**
 * Request a college that Looty does not recognise yet.
 *
 * This queue is the growth roadmap, not a support inbox — the colleges asked for
 * most often are the ones worth chasing a verified domain for. So it asks for the
 * email domain too, which is the part that actually takes work to confirm.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Field, LinkButton, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function College() {
  const { session } = useSession();
  const router = useRouter();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!session?.user.id) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase.from('college_requests').insert({
      requester_id: session.user.id,
      college_name: name.trim(),
      city: city.trim() || null,
      domain: domain.trim().toLowerCase() || null,
    });

    if (err) setError(err.message);
    else setDone(true);
    setBusy(false);
  }

  if (done) {
    return (
      <Screen>
        <Title>Request sent</Title>
        <Body>
          We will look into {name.trim()}. Until it is added you can read the groups,
          but messaging and Looty Match stay locked.
        </Body>
        <Button label="Browse groups" onPress={() => router.replace('/(app)/groups')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Request your college</Title>
      <Body>
        Tell us which college to add. The email domain is the useful part — it is
        what lets us verify students there.
      </Body>

      <View style={{ height: 8 }} />

      <Field
        label="College name"
        value={name}
        onChangeText={setName}
        placeholder="Indian Institute of Technology Bombay"
        editable={!busy}
      />
      <Field label="City" value={city} onChangeText={setCity} placeholder="Mumbai" editable={!busy} />
      <Field
        label="Student email domain (if you know it)"
        value={domain}
        onChangeText={setDomain}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="student.iitb.ac.in"
        hint="The bit after the @ in your college address."
        editable={!busy}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Button label="Send request" onPress={submit} loading={busy} disabled={name.trim().length < 3} />

      <View style={{ alignItems: 'center', paddingTop: 4 }}>
        <LinkButton label="Back" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
