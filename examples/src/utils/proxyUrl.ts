import { proxyWsUrl } from '../lib/connection';

/** Model-specific proxy URL; resource credentials remain server-side. */
export function modelProxyUrl(model = 'gpt-realtime'): string {
  return proxyWsUrl({ model });
}
