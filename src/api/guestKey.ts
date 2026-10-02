/**
 * Guest key storage (Open guest identity).
 *
 * A human join without a key mints one server-side and returns it once as
 * `guest_key`; every later human Open call sends it as `X-Lyceum-Guest`.
 * Stored under `lyceum.guest`:
 *   - native: expo-secure-store (Keychain / Keystore)
 *   - web:    localStorage (SecureStore has no web implementation)
 *
 * Native reads go through an in-memory cache so the synchronous best-effort
 * leave (background / unload) can attach the header without awaiting.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const GUEST_KEY_STORAGE_KEY = 'lyceum.guest';

/** Server format: "g_" + 43 base64url chars (openStore GUEST_KEY_RE). */
const GUEST_KEY_RE = /^g_[A-Za-z0-9_-]{43}$/;

export function isGuestKey(value: unknown): value is string {
  return typeof value === 'string' && GUEST_KEY_RE.test(value);
}

const isWeb = Platform.OS === 'web';

/** Native cache: undefined = not loaded yet; null = loaded, nothing stored. */
let nativeCache: string | null | undefined;
let nativeLoad: Promise<string | null> | null = null;

/** Web fallback when localStorage is unavailable (e.g. blocked storage). */
let webMemory: string | null = null;

function webRead(): string | null {
  try {
    const v = globalThis.localStorage?.getItem(GUEST_KEY_STORAGE_KEY) ?? null;
    return isGuestKey(v) ? v : null;
  } catch {
    return webMemory;
  }
}

function webWrite(key: string): void {
  webMemory = key;
  try {
    globalThis.localStorage?.setItem(GUEST_KEY_STORAGE_KEY, key);
  } catch {
    // storage blocked — keep the in-memory copy for this page
  }
}

async function nativeRead(): Promise<string | null> {
  if (nativeCache !== undefined) return nativeCache;
  if (!nativeLoad) {
    nativeLoad = (async () => {
      try {
        const v = await SecureStore.getItemAsync(GUEST_KEY_STORAGE_KEY);
        // A write may have landed while we were reading — it wins.
        if (nativeCache === undefined) nativeCache = isGuestKey(v) ? v : null;
      } catch {
        if (nativeCache === undefined) nativeCache = null;
      } finally {
        nativeLoad = null;
      }
      return nativeCache ?? null;
    })();
  }
  return nativeLoad;
}

/** Stored guest key, or null. Web reads storage each time (other tabs may write). */
export async function getGuestKey(): Promise<string | null> {
  if (isWeb) return webRead();
  return nativeRead();
}

/**
 * Synchronous read for fire-and-forget paths (unload / background leave).
 * Native returns the cached value (loaded by any earlier request or join).
 */
export function getGuestKeySync(): string | null {
  if (isWeb) return webRead();
  return nativeCache ?? null;
}

/**
 * Persist a freshly minted key. Resolves once the write has finished, so a
 * caller can await it before entering the room. Malformed values are ignored.
 * If the native keychain write fails, the key is still kept in memory for this
 * run (the name stays usable until the app is killed) and the error is logged.
 */
export async function setGuestKey(key: string): Promise<void> {
  if (!isGuestKey(key)) return;
  if (isWeb) {
    webWrite(key);
    return;
  }
  nativeCache = key;
  try {
    await SecureStore.setItemAsync(GUEST_KEY_STORAGE_KEY, key);
  } catch (e) {
    console.warn('guestKey: SecureStore write failed; key kept in memory only', e);
  }
}
