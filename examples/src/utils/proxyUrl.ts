/** Build a model connection without putting resource credentials in browser code. */
export function modelProxyUrl(model: string = 'gpt-realtime'): string {
  const url = new URL(import.meta.env.VITE_BACKEND_PROXY_URL || 'ws://localhost:8080/ws');
  if (url.pathname === '/') url.pathname = '/ws';
  url.searchParams.set('model', model);
  return url.toString();
}
