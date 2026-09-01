/**
 * Read a local file URI as raw JPEG bytes for Storage uploads.
 *
 * React Native's `response.blob()` reports type `text/plain`. The avatars
 * bucket only allows jpeg/png/webp, so that upload is refused even when we
 * pass contentType in the options — Storage trusts the blob's own type.
 * ArrayBuffer has no MIME; the contentType we send is the one that counts.
 */

export async function jpegBytesFromUri(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  return res.arrayBuffer();
}
