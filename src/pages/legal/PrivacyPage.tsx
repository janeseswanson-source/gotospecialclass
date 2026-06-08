import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PrivacyPage = () => (
  <div className="min-h-screen bg-background">
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Button variant="ghost" size="sm" asChild className="mb-8">
        <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
      </Button>
      <h1 className="text-3xl font-bold text-foreground mb-6">Privacy Policy</h1>
      <div className="prose prose-sm text-muted-foreground space-y-4">
        <p><strong>Last updated:</strong> March 18, 2026</p>
        <h2 className="text-lg font-semibold text-foreground">1. Information We Collect</h2>
        <p>We collect information you provide directly: name, email address, school name, and scheduling data (teacher names, specialist assignments, grade levels).</p>
        <h2 className="text-lg font-semibold text-foreground">2. How We Use Information</h2>
        <p>We use your information solely to provide the scheduling service, improve our product, and communicate with you about your account.</p>
        <h2 className="text-lg font-semibold text-foreground">3. Data Storage & Security</h2>
        <p>Your data is stored securely using industry-standard encryption. We do not sell or share your personal information with third parties.</p>
        <h2 className="text-lg font-semibold text-foreground">4. Student Data (FERPA)</h2>
        <p>Specialist Ops! does not collect, store, or process individual student data. Our service handles only staff scheduling information.</p>
        <h2 className="text-lg font-semibold text-foreground">5. Cookies</h2>
        <p>We use essential cookies for authentication and session management. No advertising or tracking cookies are used.</p>
        <h2 className="text-lg font-semibold text-foreground">6. Data Retention</h2>
        <p>Your data is retained as long as your account is active. You may request deletion of your data at any time by contacting us.</p>
        <h2 className="text-lg font-semibold text-foreground">7. Your Rights</h2>
        <p>You have the right to access, correct, or delete your personal data. Contact us at support@gotospecialclass.com.</p>
        <h2 className="text-lg font-semibold text-foreground">8. Changes</h2>
        <p>We may update this policy from time to time. We will notify you of significant changes via email.</p>
      </div>
    </div>
  </div>
);

export default PrivacyPage;
