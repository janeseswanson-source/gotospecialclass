import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "next-themes";
import ProtectedRoute from "@/components/ProtectedRoute";
import GatedRoute from "@/components/GatedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Legal pages
import TermsPage from "@/pages/legal/TermsPage";
import PrivacyPage from "@/pages/legal/PrivacyPage";

// Layouts
import AppLayout from "@/components/layouts/AppLayout";
import AdminLayout from "@/components/layouts/AdminLayout";

// Auth pages
import LoginPage from "@/pages/auth/LoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage";
import EmailConfirmationPage from "@/pages/auth/EmailConfirmationPage";

// Public
import LandingPage from "@/pages/LandingPage";

// App pages
import DashboardPage from "@/pages/dashboard/DashboardPage";
import SetupPage from "@/pages/setup/SetupPage";
import CoordinatorPrep from "@/pages/setup/CoordinatorPrep";
import PrepPage from "@/pages/schedule/PrepPage";
import MasterSchedulePage from "@/pages/schedule/MasterSchedulePage";
import SpecialistPlannerPage from "@/pages/schedule/SpecialistPlannerPage";
import LessonPlannerPage from "@/pages/schedule/LessonPlannerPage";
import ExportsPage from "@/pages/schedule/ExportsPage";
import ScheduleSuccessPage from "@/pages/schedule/ScheduleSuccessPage";
import BillingPage from "@/pages/app/BillingPage";
import SettingsPage from "@/pages/app/SettingsPage";
import SchoolsPage from "@/pages/app/SchoolsPage";

// Admin pages
import { AdminOverview, AdminRevenue, AdminUsers, AdminWorkspaces, AdminSchools, AdminCRM, AdminLicenses, AdminBilling, AdminCosts, AdminAICosts, AdminActivity, AdminSettings } from "@/pages/admin/AdminPages";
import AdminProtectedRoute from "@/components/admin/AdminProtectedRoute";

import AcceptInvitePage from "@/pages/auth/AcceptInvitePage";
import HelpPage from "@/pages/app/HelpPage";
import AdminSupportPage from "@/pages/admin/AdminSupportPage";
import NotFound from "./pages/NotFound";

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

                {/* Protected customer portal */}
                <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route index element={<Navigate to="/app/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="setup" element={<GatedRoute><SetupPage /></GatedRoute>} />
                  <Route path="coordinator-prep" element={<CoordinatorPrep />} />
                  <Route path="prep" element={<GatedRoute><PrepPage /></GatedRoute>} />
                  <Route path="schedule" element={<GatedRoute><MasterSchedulePage /></GatedRoute>} />
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
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
