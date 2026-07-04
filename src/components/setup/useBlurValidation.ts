// Lightweight inline-validation for wizard forms: track which fields the user has
// "touched" (blurred) and only surface an error once they've left the field, so
// errors don't scream while the user is still typing. Pair with <FieldError>.
import { useCallback, useState } from 'react';

export interface BlurValidation {
  /** Mark a field touched (call from onBlur). */
  touch: (key: string) => void;
  /** Mark every listed field touched at once (call before a gated "Continue"). */
  touchAll: (keys: string[]) => void;
  /** The error to show for a field: `error` if touched, else null. */
  errorFor: (key: string, error: string | null | undefined) => string | null;
  touched: Record<string, boolean>;
}

export function useBlurValidation(): BlurValidation {
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const touch = useCallback((key: string) => {
    setTouched(prev => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  const touchAll = useCallback((keys: string[]) => {
    setTouched(prev => {
      const next = { ...prev };
      let changed = false;
      for (const k of keys) if (!next[k]) { next[k] = true; changed = true; }
      return changed ? next : prev;
    });
  }, []);

  const errorFor = useCallback(
    (key: string, error: string | null | undefined) => (touched[key] && error ? error : null),
    [touched],
  );

  return { touch, touchAll, errorFor, touched };
}
