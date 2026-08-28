/**
 * Supabase client.
 *
 * The project must be created in `ap-south-1` (Mumbai). Chat round-trips the server
 * on every message: Mumbai is ~20–40ms from Indian users, US-East is ~250ms+, and
 * the difference is the whole feel of the app. The region is fixed at project
 * creation and cannot be changed without a full migration — see CONTEXT.md §5.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * False until `.env` is filled in. The app shows a setup screen instead of
 * crashing, so the shell can be run and navigated before a Supabase project
 * exists. Deliberately not a thrown error at import time — that red-screens the
 * app before anything renders.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'placeholder-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: isSupabaseConfigured,
      persistSession: true,
      // Native app: there is no URL to parse a session out of.
      detectSessionInUrl: false,
    },
  },
);

/**
 * The anon key is public by design — it ships in the app binary and is not a
 * secret. Everything that matters is enforced by RLS and column grants in the
 * database, which is why `trust_tier`, `full_name` and `phone_hash` are not merely
 * hidden but ungranted. The service-role key must NEVER appear in this app.
 */
