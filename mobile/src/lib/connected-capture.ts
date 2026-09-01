/**
 * Screenshot handling for Connected chats only.
 *
 * Android 14+ (API 34): capture is allowed; we notify the other person.
 * Below 14: FLAG_SECURE — screenshots are blocked. There is no detection API.
 *
 * FLAG_SECURE is per-Activity. Expo has one Activity, so it must be set on
 * entering this chat and cleared on leaving, or it blanks the whole app
 * (profiles, groups, recents). See CONTEXT.md §7.
 *
 * Do not ask for READ_MEDIA_IMAGES. Play's photo policy forbids it unless the
 * app's purpose is broad photo access, and below 14 we block instead of detect.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

import { supabase } from './supabase';

function androidApi(): number {
  if (Platform.OS !== 'android') return 0;
  const v = Platform.Version;
  return typeof v === 'string' ? parseInt(v, 10) : v;
}

export function useConnectedCapture(threadId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !threadId || Platform.OS !== 'android') return;

    const key = `connected:${threadId}`;

    if (androidApi() >= 34) {
      const sub = ScreenCapture.addScreenshotListener(() => {
        void supabase.rpc('record_screenshot', { p_thread: threadId });
      });
      return () => sub.remove();
    }

    void ScreenCapture.preventScreenCaptureAsync(key);
    return () => {
      void ScreenCapture.allowScreenCaptureAsync(key);
    };
  }, [threadId, enabled]);
}
