import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "next-themes";
import { Suspense } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import GatedRoute from "@/components/GatedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RouteFallback } from "@/components/RouteFallback";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Layouts + guards stay eager — they render the shell around every lazy route.
import AppLayout from "@/components/layouts/AppLayout";
import AdminLayout from "@/components/layouts/AdminLayout";
import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";

// Every route group is code-split with React.lazy so the initial bundle carries
// only the shell + the landing page. Heavy feature deps (schedule grid, PDF,
// xlsx, AI chat) ride along in their own route chunks, loaded on navigation.

// Public / auth
const LandingPage = lazyWithRetry(() => import("@/pages/LandingPage"));
const LoginPage = lazyWithRetry(() => import("@/pages/auth/LoginPage"));
const SignupPage = lazyWithRetry(() => import("@/pages/auth/SignupPage"));
const ForgotPasswordPage = lazyWithRetry(() => import("@/pages/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazyWithRetry(() => import("@/pages/auth/ResetPasswordPage"));
const EmailConfirmationPage = lazyWithRetry(() => import("@/pages/auth/EmailConfirmationPage"));
const AcceptInvitePage = lazyWithRetry(() => import("@/pages/auth/AcceptInvitePage"));
const TermsPage = lazyWithRetry(() => import("@/pages/legal/TermsPage"));
const PrivacyPage = lazyWithRetry(() => import("@/pages/legal/PrivacyPage"));
const OAuthConsent = lazyWithRetry(() => import("@/pages/auth/OAuthConsent"));

// App pages
const DashboardPage = lazyWithRetry(() => import("@/pages/dashboard/DashboardPage"));
const SetupPage = lazyWithRetry(() => import("@/pages/setup/SetupPage"));
const CoordinatorPrep = lazyWithRetry(() => import("@/pages/setup/CoordinatorPrep"));
const PrepPage = lazyWithRetry(() => import("@/pages/schedule/PrepPage"));
const MasterSchedulePage = lazyWithRetry(() => import("@/pages/schedule/MasterSchedulePage"));
const MasterAdminViewPage = lazyWithRetry(() => import("@/pages/schedule/MasterAdminViewPage"));
const CompliancePage = lazyWithRetry(() => import("@/pages/schedule/CompliancePage"));
const SpecialistPlannerPage = lazyWithRetry(() => import("@/pages/schedule/SpecialistPlannerPage"));
const LessonPlannerPage = lazyWithRetry(() => import("@/pages/schedule/LessonPlannerPage"));
const ExportsPage = lazyWithRetry(() => import("@/pages/schedule/ExportsPage"));
const ScheduleSuccessPage = lazyWithRetry(() => import("@/pages/schedule/ScheduleSuccessPage"));
const BillingPage = lazyWithRetry(() => import("@/pages/app/BillingPage"));
const SettingsPage = lazyWithRetry(() => import("@/pages/app/SettingsPage"));
const SchoolsPage = lazyWithRetry(() => import("@/pages/app/SchoolsPage"));
const HelpPage = lazyWithRetry(() => import("@/pages/app/HelpPage"));

// Admin pages (each is a named export from the AdminPages barrel)
const AdminOverview = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminOverview })));
const AdminRevenue = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminRevenue })));
const AdminUsers = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminUsers })));
const AdminWorkspaces = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminWorkspaces })));
const AdminSchools = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminSchools })));
const AdminCRM = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminCRM })));
const AdminLicenses = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminLicenses })));
const AdminBilling = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminBilling })));
const AdminCosts = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminCosts })));
const AdminAICosts = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminAICosts })));
const AdminActivity = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminActivity })));
const AdminSettings = lazyWithRetry(() => import("@/pages/admin/AdminPages").then((m) => ({ default: m.AdminSettings })));
const AdminSupportPage = lazyWithRetry(() => import("@/pages/admin/AdminSupportPage"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/email-confirmation" element={<EmailConfirmationPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />
                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />


                {/* Protected customer portal */}
                <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route index element={<Navigate to="/app/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="setup" element={<GatedRoute><SetupPage /></GatedRoute>} />
                  <Route path="coordinator-prep" element={<CoordinatorPrep />} />
                  <Route path="prep" element={<GatedRoute><PrepPage /></GatedRoute>} />
                  <Route path="schedule" element={<GatedRoute><MasterSchedulePage /></GatedRoute>} />
                  <Route path="admin-view" element={<GatedRoute><MasterAdminViewPage /></GatedRoute>} />
                  <Route path="compliance" element={<GatedRoute><CompliancePage /></GatedRoute>} />
                  <Route path="planner" element={<GatedRoute><SpecialistPlannerPage /></GatedRoute>} />
                  <Route path="lesson-planner" element={<GatedRoute><LessonPlannerPage /></GatedRoute>} />
                  <Route path="exports" element={<GatedRoute><ExportsPage /></GatedRoute>} />
                  <Route path="schedule-success" element={<GatedRoute><ScheduleSuccessPage /></GatedRoute>} />
                  <Route path="billing" element={<BillingPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="help" element={<HelpPage />} />
                  <Route path="schools" element={<SchoolsPage />} />
                </Route>

                {/* Protected admin area */}
                <Route path="/admin" element={<ProtectedRoute><AdminProtectedRoute><AdminLayout /></AdminProtectedRoute></ProtectedRoute>}>
                  <Route index element={<AdminOverview />} />
                  <Route path="revenue" element={<AdminRevenue />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="workspaces" element={<AdminWorkspaces />} />
                  <Route path="schools" element={<AdminSchools />} />
                  <Route path="crm" element={<AdminCRM />} />
                  <Route path="licenses" element={<AdminLicenses />} />
                  <Route path="billing" element={<AdminBilling />} />
                  <Route path="costs" element={<AdminCosts />} />
                  <Route path="ai-costs" element={<AdminAICosts />} />
                  <Route path="activity" element={<AdminActivity />} />
                  <Route path="settings" element={<AdminSettings />} />
                  <Route path="support" element={<AdminSupportPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
