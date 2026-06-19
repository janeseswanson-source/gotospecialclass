import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import logo from '@/assets/nsc-wordmark.png';
import { useAuth } from '@/contexts/AuthContext';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const SignupPage = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const validatePassword = (pw: string) => {
    const errors: string[] = [];
    if (pw.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(pw)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(pw)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(pw)) errors.push('One number');
    return errors;
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    setPasswordErrors(value.length > 0 ? validatePassword(value) : []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pwErrors = validatePassword(password);
    if (pwErrors.length > 0) {
      setPasswordErrors(pwErrors);
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password, name);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    // Store license key in localStorage so it can be redeemed after email confirmation
    if (licenseKey.trim()) {
      localStorage.setItem('pending_license_key', licenseKey.trim());
    }

    setLoading(false);
    navigate('/email-confirmation');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <img src={logo} alt="Next Specials Class" className="mx-auto mb-4 h-12 w-auto" />
          <h1 className="text-2xl font-bold text-foreground">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Start scheduling smarter today</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => handlePasswordChange(e.target.value)} placeholder="Min 8 characters" required minLength={8} />
              {password.length > 0 && passwordErrors.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {passwordErrors.map((err) => (
                    <li key={err} className="text-xs text-destructive">• {err}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* License key — optional */}
            <div className="space-y-2 rounded-lg border border-dashed border-border bg-secondary/50 p-3">
              <Label htmlFor="license" className="text-xs text-muted-foreground">Have a license key? (optional)</Label>
              <Input id="license" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="XXXX-XXXX-XXXX" className="text-sm" />
            </div>

            <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          By signing up, you agree to our{' '}
          <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>{' '}and{' '}
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
};

export default SignupPage;
