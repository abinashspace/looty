/**
 * Optional profile photo: downscale then upload to avatars/<userId>/dp.jpg.
 *
 * A DP is never displayed larger than a Match card. The picker hands back a
 * full-camera crop; at 512px the object is nearer 50 KB. Storage's 2 MB cap is
 * the backstop, not the plan. Bytes go as ArrayBuffer so RN does not label
 * them text/plain (see jpeg-bytes.ts).
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { jpegBytesFromUri } from './jpeg-bytes';
import { supabase } from './supabase';

const DP_MAX_PX = 512;
const DP_QUALITY = 0.7;

export async function downscaleProfilePhoto(uri: string, sourceWidth?: number): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(uri);
    if (!sourceWidth || sourceWidth > DP_MAX_PX) context.resize({ width: DP_MAX_PX });
    const rendered = await context.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: DP_QUALITY });
    return out.uri;
  } catch {
    return uri;
  }
}

export async function uploadProfilePhoto(userId: string, uri: string): Promise<string> {
  const path = `${userId}/dp.jpg`;
  const bytes = await jpegBytesFromUri(uri);
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);
  const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  // Cache-bust: same path is upserted, so clients would keep the old image.
  return `${publicUrl}?t=${Date.now()}`;
}

export async function removeProfilePhoto(userId: string): Promise<void> {
  await supabase.storage.from('avatars').remove([`${userId}/dp.jpg`]);
}
