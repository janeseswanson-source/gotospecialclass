// Local draft of an in-progress setup session.
//
// The wizard holds everything in React state and rehydrates only from the
// database, so a failed save — or simply closing the tab — used to discard
// every unsaved answer. ("I SOMEHOW CLICKED OUT AND IT DIDNT AUTO SAVE —
// START OVER.") This mirrors the working copy into localStorage so it can be
// offered back.
//
// Restore is deliberately OPT-IN: silently replaying a stale draft over
// freshly-loaded database values would be its own kind of data loss.

import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "sos.setupDraft.v1";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const DEBOUNCE_MS = 500;

export interface SetupDraft<T> {
  v: 1;
  savedAt: string;
  schoolId: string | null;
  step: number;
  data: T;
}

export function draftKey(workspaceId: string | null | undefined, schoolId: string | null | undefined): string {
  return `${PREFIX}.${workspaceId ?? "anon"}.${schoolId ?? "new"}`;
}

function readDraft<T>(key: string): SetupDraft<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SetupDraft<T>;
    if (parsed?.v !== 1 || !parsed.savedAt) return null;
    if (Date.now() - new Date(parsed.savedAt).getTime() > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null; // private mode / corrupt entry — never break the wizard
  }
}

export interface UseSetupDraft<T> {
  /** A recoverable draft found on mount, or null. Cleared by restore/discard. */
  available: SetupDraft<T> | null;
  restore: () => SetupDraft<T> | null;
  discard: () => void;
  /** Call after a completed setup so we stop offering the draft. */
  clear: () => void;
}

/**
 * Persist `data`/`step` under a workspace+school key, and surface any draft
 * that was already there when the wizard mounted.
 */
export function useSetupDraft<T>(
  workspaceId: string | null | undefined,
  schoolId: string | null | undefined,
  data: T,
  step: number,
  enabled = true,
): UseSetupDraft<T> {
  const key = draftKey(workspaceId, schoolId);
  const keyRef = useRef(key);
  const [available, setAvailable] = useState<SetupDraft<T> | null>(null);
  const checked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // One look, on mount, before we start writing over it.
  useEffect(() => {
    if (checked.current || !enabled) return;
    checked.current = true;
    setAvailable(readDraft<T>(key));
  }, [key, enabled]);

  // A brand-new school gets its id after the first successful save; carry the
  // draft across so it isn't orphaned under the "new" key.
  useEffect(() => {
    const prev = keyRef.current;
    if (prev === key) return;
    try {
      const carried = localStorage.getItem(prev);
      if (carried && !localStorage.getItem(key)) localStorage.setItem(key, carried);
      if (carried) localStorage.removeItem(prev);
    } catch { /* ignore */ }
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const draft: SetupDraft<T> = {
          v: 1,
          savedAt: new Date().toISOString(),
          schoolId: schoolId ?? null,
          step,
          data,
        };
        localStorage.setItem(keyRef.current, JSON.stringify(draft));
      } catch { /* quota / private mode — the draft is a bonus, not a contract */ }
    }, DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [data, step, schoolId, enabled]);

  const restore = useCallback(() => {
    const d = available;
    setAvailable(null);
    return d;
  }, [available]);

  const discard = useCallback(() => {
    try { localStorage.removeItem(keyRef.current); } catch { /* ignore */ }
    setAvailable(null);
  }, []);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(keyRef.current);
      localStorage.removeItem(draftKey(workspaceId, null));
    } catch { /* ignore */ }
    setAvailable(null);
  }, [workspaceId]);

  return { available, restore, discard, clear };
}
