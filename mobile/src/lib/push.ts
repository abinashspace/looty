/**
 * Register this phone's Expo push token.
 *
 * `push_tokens` has no client table grants. The only writes are
 * `register_push_token` / `unregister_push_token`. A token uniquely identifies
 * a device, so signing into a different account on the same phone moves it.
 *
 * Remote tokens do not exist in Expo Go on Android from SDK 53. This is a
 * no-op there. A native / EAS build plus an EAS `projectId` is required before
 * a row is actually inserted. Nothing is *sent* yet — this only stores the
 * address a future sender would use.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const STORAGE_KEY = 'looty.pushToken';

function inExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

function easProjectId(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra;
  const fromEas = Constants.easConfig?.projectId;
  return typeof fromEas === 'string' && fromEas.length > 0 ? fromEas : null;
}

export async function registerPushToken(): Promise<void> {
  if (inExpoGo()) return;
  const projectId = easProjectId();
  if (!projectId) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Looty',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return;
  }
  if (!token || token.length < 16) return;

  const { error } = await supabase.rpc('register_push_token', { p_token: token });
  if (error) return;
  await AsyncStorage.setItem(STORAGE_KEY, token);
}

export async function unregisterPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(STORAGE_KEY);
  if (!token) return;
  await supabase.rpc('unregister_push_token', { p_token: token });
  await AsyncStorage.removeItem(STORAGE_KEY);
}
