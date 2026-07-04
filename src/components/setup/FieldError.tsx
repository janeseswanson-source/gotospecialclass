// Inline field error line for wizard forms. Renders nothing when `error` is falsy
// so it takes no layout space until there's something to say.
import { AlertCircle } from 'lucide-react';

export function FieldError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive" role="alert">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {error}
    </p>
  );
}

export default FieldError;
