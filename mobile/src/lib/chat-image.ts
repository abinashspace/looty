/**
 * Upload a chat photo into the private chat-images bucket.
 *
 * Path is <userId>/<threadId>/<uuid>.jpg — storage RLS keys on both segments,
 * so a client cannot write into another person's folder or into a thread they
 * cannot currently post to. The database stores that path, not a URL; a signed
 * URL is minted at display time so the object stays private.
 *
 * Downscale matches profile photos: only ever shrinks, falls back to the
 * original if manipulation fails. Chat images are not cropped square.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { jpegBytesFromUri } from './jpeg-bytes';
import { supabase } from './supabase';

const MAX_PX = 1080;
const QUALITY = 0.7;

export async function downscaleChatImage(uri: string, sourceWidth?: number): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(uri);
    if (!sourceWidth || sourceWidth > MAX_PX) context.resize({ width: MAX_PX });
    const rendered = await context.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY });
    return out.uri;
  } catch {
    return uri;
  }
}

export async function uploadChatImage(opts: {
  userId: string;
  threadId: string;
  uri: string;
  sourceWidth?: number;
}): Promise<string> {
  const local = await downscaleChatImage(opts.uri, opts.sourceWidth);
  const bytes = await jpegBytesFromUri(local);
  const path = `${opts.userId}/${opts.threadId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from('chat-images')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function signedChatImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('chat-images')
    .createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
