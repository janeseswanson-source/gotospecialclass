import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * Flush a pending debounced save when the component unmounts.
 *
 * The setup wizard remounts the active step component whenever the user
 * switches tabs (see SetupWizardContent's `key={step}`). Without this hook,
 * the existing `clearTimeout` cleanup silently cancels in-flight saves and
 * the user loses unsaved changes.
 *
 * Usage:
 *   const saveTimer = useRef<ReturnType<typeof setTimeout>>();
 *   // ... your existing debounced effect ...
 *   useFlushOnUnmount(saveTimer, () => autoSave(latestValue));
 */
export function useFlushOnUnmount(
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | undefined>,
  flush: () => void
) {
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        try {
          flushRef.current();
        } catch {
          // swallow; component is gone, can't surface error
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
