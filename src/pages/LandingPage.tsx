import { Link } from 'react-router-dom';
import logo from '@/assets/logo.png';
import { CalendarDays, Wand2, Users, Download, School, Shield, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  { icon: CalendarDays, title: 'AI Calendar Parsing', desc: 'Upload your school calendar and let AI extract holidays, early releases, and no-school days automatically.' },
  { icon: Wand2, title: 'One-Click Generation', desc: 'Generate a conflict-free master schedule in seconds with our intelligent scheduling engine.' },
  { icon: Users, title: 'Specialist Planner', desc: 'View each specialist\'s weekly schedule at a glance with drag-and-drop adjustments.' },
  { icon: Download, title: 'Export Center', desc: 'Download schedules as PDF, CSV, or DOC — ready for teachers, parents, and admin.' },
  { icon: School, title: 'Multi-School Support', desc: 'Manage multiple schools under one workspace with shared specialists and resources.' },
  { icon: Shield, title: 'Conflict Resolution', desc: 'Choose from 7 conflict strategies including A/B week, AA/BB rotation, quick 30, big group, makeup, and extra rotation.' },
];

const steps = [
  { num: '1', title: 'Setup', desc: 'Enter school info, grades, teachers, specialists, and upload your calendar.' },
  { num: '2', title: 'Generate', desc: 'Click generate and our AI builds a conflict-free master schedule instantly.' },
  { num: '3', title: 'Share', desc: 'Export and distribute schedules to your entire staff in minutes.' },
];

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="GoToSpecialClass logo" className="h-9 w-9 rounded-lg object-cover" />
            <span className="text-lg font-bold text-foreground">Specialist Ops!</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild><Link to="/login">Sign In</Link></Button>
            <Button asChild><Link to="/signup">Get Started</Link></Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Built for Grades K–6 Specials Coordinators
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl leading-tight">
            Stop Scheduling by Hand.
            <br />
            <span className="text-primary">Start Scheduling by AI.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Specialist Ops! automates Grades K–6 specials scheduling — art, music, PE, library — so you can focus on what matters: your students.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" className="gap-2 text-base px-8" asChild>
              <Link to="/signup">Get Started Free <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <Button size="lg" variant="outline" className="text-base px-8" asChild>
              <Link to="/login">Sign In</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-border bg-card py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-bold text-card-foreground sm:text-3xl">Scheduling specials shouldn't take weeks.</h2>
          <p className="mt-4 text-muted-foreground">
            Most coordinators spend 40+ hours building master schedules in spreadsheets — juggling lunch blocks, recess, teacher preferences, and room conflicts. One change cascades into chaos. There's a better way.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-14">
            <h2 className="text-2xl font-bold sm:text-3xl">Everything you need to schedule smarter</h2>
            <p className="mt-3 text-muted-foreground">Powerful tools designed specifically for Grades K–6 specials coordinators.</p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-card p-6 transition-all hover:shadow-md hover:-translate-y-0.5">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-card-foreground">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-y border-border bg-card py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center mb-14">
            <h2 className="text-2xl font-bold sm:text-3xl">Three steps to a perfect schedule</h2>
          </div>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold">
                  {s.num}
                </div>
                <h3 className="font-semibold text-card-foreground text-lg">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20">
        <div className="mx-auto max-w-md px-6 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl mb-10">Simple pricing</h2>
          <div className="rounded-xl border-2 border-primary bg-card p-8">
            <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">Pro Plan</span>
            <p className="text-4xl font-extrabold text-card-foreground">License Key</p>
            <p className="mt-2 text-sm text-muted-foreground">Activate with a license key from your district or administrator.</p>
            <ul className="mt-6 space-y-3 text-left text-sm">
              {['Up to 5 schools', 'Unlimited schedules', 'All export formats', 'AI calendar parsing', 'Priority support'].map((item) => (
                <li key={item} className="flex items-center gap-2 text-card-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> {item}
                </li>
              ))}
            </ul>
            <Button className="mt-8 w-full" size="lg" asChild>
              <Link to="/signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-10">
        <div className="mx-auto max-w-6xl px-6 flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-xs">SO</div>
            <span className="text-sm font-semibold text-card-foreground">Specialist Ops!</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/terms" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Terms of Service</Link>
            <Link to="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</Link>
            <a href="mailto:support@gotospecialclass.com" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Contact</a>
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Specialist Ops! All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
