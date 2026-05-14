// auth.ts — RC token retrieval for DataApp iframe context

import parentBridge from "./parentBridge";

function getDataAppSlug(): string | null {
  const url = window.location.href;
  if (!url.includes("/dataapps/")) return null;
  const afterDataapps = url.split("/dataapps/")[1];
  return afterDataapps?.split("/")[0] ?? null;
}

/** Check if a JWT is expired — treat as expired 60s early so we don't send a token about to die. */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false; // no expiry claim — assume valid
    return payload.exp * 1000 < Date.now() + 60_000;
  } catch {
    return false; // can't parse — let the server decide
  }
}

function getDataAppToken(slug: string): string | null {
  const storageKey = "dataapp_tokens";
  try {
    const existing = localStorage.getItem(storageKey);
    if (!existing) return null;
    const storedObj: Record<string, Record<string, string>> = JSON.parse(existing);
    // Skip expired entries so a stale token from a previous tenant doesn't beat a fresh one.
    for (const tenantId of Object.keys(storedObj)) {
      const token = storedObj[tenantId]?.[slug];
      if (token && !isTokenExpired(token)) return token;
    }
  } catch {
    // invalid JSON — ignore
  }
  return null;
}

export async function getToken(): Promise<string | undefined> {
  // 1. DataApp token from localStorage (keyed by slug)
  const slug = getDataAppSlug();
  if (slug) {
    const dataAppToken = getDataAppToken(slug);
    if (dataAppToken) {
      if (!isTokenExpired(dataAppToken)) return dataAppToken;
      console.warn('[auth] localStorage token expired, trying other methods');
    }
  }

  // 2. URL query param ?token=
  try {
    const decodedUrl = decodeURIComponent(window.location.href);
    const tokenFromParams = new URL(decodedUrl).searchParams.get("token");
    if (tokenFromParams && !isTokenExpired(tokenFromParams)) return tokenFromParams;
  } catch {
    // malformed URL — ignore
  }

  // 3. Parent frame via postMessage bridge
  const token = await parentBridge.get("token");
  if (token && !isTokenExpired(token)) return token;

  console.warn(
    '[auth] No valid token found. Tried: localStorage slug=%s, URL params, parentBridge.',
    slug ?? '(none)',
  );
  return undefined;
}
