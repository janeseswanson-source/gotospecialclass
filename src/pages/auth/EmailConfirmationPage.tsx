import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const EmailConfirmationPage = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MailCheck className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a confirmation link to your email address. Click the link to activate your account.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-card p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Didn't receive it? Check your spam folder or try signing up again.
          </p>
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline">
              <Link to="/login">Go to Sign In</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/signup">Try again</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailConfirmationPage;
