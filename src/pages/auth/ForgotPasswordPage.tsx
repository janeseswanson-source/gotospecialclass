import { useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '@/assets/logo.png';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await resetPassword(email);
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <img src={logo} alt="GoToSpecialClass logo" className="mx-auto mb-4 h-14 w-14 rounded-2xl object-cover" />
          <h1 className="text-2xl font-bold text-foreground">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">We'll send you a reset link</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          {sent ? (
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">✓</div>
              <p className="text-sm text-muted-foreground">Check your email for a password reset link.</p>
              <Link to="/login" className="text-sm font-medium text-primary hover:underline">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
