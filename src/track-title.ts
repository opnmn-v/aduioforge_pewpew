import { youtubeId } from "./model";

export async function trackTitle(value: string): Promise<string | undefined> {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const id = youtubeId(value);
    if (id) {
      const endpoint = new URL('https://www.youtube.com/oembed');
      endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${id}`);
      endpoint.searchParams.set('format', 'json');
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const data = await response.json();
      return typeof data.title === 'string' ? data.title.trim().slice(0, 80) || undefined : undefined;
    }
    const filename = decodeURIComponent(url.pathname.split('/').pop() || '');
    return filename.replace(/\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)$/i, '').trim().slice(0, 80) || undefined;
  } catch { return undefined; }
}
