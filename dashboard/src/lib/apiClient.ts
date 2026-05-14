/**
 * Resolves API paths for dev (Vite proxy) and production (RC FastAPI).
 * Injects RC auth token (Bearer) on every request.
 *
 * Dev:  localhost -> fetch('/api/tables') via Vite proxy
 * Prod: RC platform -> fetch('/fastapiapps/{id}/db-explorer/api/tables')
 */

import { getToken } from '@/utils/auth';

function getBaseUrl(): string {
  // 1. VITE_API_URL — set by deploy-frontend.sh at build time. May be a full
  //    URL (https://host/fastapiapps/<id>/<name>) or a path. Use as-is; when
  //    the page is served from the same origin (RC platform), the path-only
  //    form keeps requests same-origin.
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    try {
      const parsed = new URL(apiUrl);
      const sameOrigin = typeof window !== 'undefined' && parsed.origin === window.location.origin;
      return sameOrigin ? parsed.pathname.replace(/\/$/, '') : apiUrl.replace(/\/$/, '');
    } catch {
      return apiUrl.replace(/\/$/, '');
    }
  }
  // 2. VITE_BACKEND_URL — explicit override
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  // 3. Local dev — empty base, Vite proxy handles /api/*
  return '';
}

export function apiUrl(path: string): string {
  return `${getBaseUrl()}${path}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getBaseUrl();
  const url = `${base}${path}`;

  // Skip auth token for local dev (empty base = Vite proxy)
  if (base) {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    } else {
      console.warn('[apiClient] No auth token — expect 401', url);
    }
    return fetch(url, { ...init, headers, credentials: 'omit' });
  }
  return fetch(url, init);
}
