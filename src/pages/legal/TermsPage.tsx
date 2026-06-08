import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TermsPage = () => (
  <div className="min-h-screen bg-background">
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Button variant="ghost" size="sm" asChild className="mb-8">
        <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
      </Button>
      <h1 className="text-3xl font-bold text-foreground mb-6">Terms of Service</h1>
      <div className="prose prose-sm text-muted-foreground space-y-4">
        <p><strong>Last updated:</strong> March 18, 2026</p>
        <h2 className="text-lg font-semibold text-foreground">1. Acceptance of Terms</h2>
        <p>By accessing or using Specialist Ops! ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
        <h2 className="text-lg font-semibold text-foreground">2. Description of Service</h2>
        <p>Specialist Ops! provides AI-powered scheduling tools for K-12 schools to manage specialist teacher rotations, classroom assignments, and related workflows.</p>
        <h2 className="text-lg font-semibold text-foreground">3. User Accounts</h2>
        <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account.</p>
        <h2 className="text-lg font-semibold text-foreground">4. Acceptable Use</h2>
        <p>You agree not to misuse the Service, attempt unauthorized access, or use the Service for any unlawful purpose.</p>
        <h2 className="text-lg font-semibold text-foreground">5. Data & Privacy</h2>
        <p>Your use of the Service is also governed by our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.</p>
        <h2 className="text-lg font-semibold text-foreground">6. Limitation of Liability</h2>
        <p>The Service is provided "as is" without warranties. We shall not be liable for any indirect, incidental, or consequential damages.</p>
        <h2 className="text-lg font-semibold text-foreground">7. Changes</h2>
        <p>We reserve the right to modify these terms at any time. Continued use constitutes acceptance of changes.</p>
        <h2 className="text-lg font-semibold text-foreground">8. Contact</h2>
        <p>Questions? Contact us at support@gotospecialclass.com.</p>
      </div>
    </div>
  </div>
);

export default TermsPage;
