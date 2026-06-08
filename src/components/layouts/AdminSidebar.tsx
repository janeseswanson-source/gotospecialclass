import { useLocation, Link } from 'react-router-dom';
import logo from '@/assets/logo.png';
import {
  LayoutDashboard, DollarSign, Users, Building2, School, Contact,
  Key, CreditCard, Server, Brain, Activity, Settings, ArrowLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

const adminNavItems = [
  { label: 'Overview', icon: LayoutDashboard, path: '/admin' },
  { label: 'Revenue', icon: DollarSign, path: '/admin/revenue' },
  { label: 'Users', icon: Users, path: '/admin/users' },
  { label: 'Workspaces', icon: Building2, path: '/admin/workspaces' },
  { label: 'Schools', icon: School, path: '/admin/schools' },
  { label: 'CRM', icon: Contact, path: '/admin/crm' },
  { label: 'Licenses', icon: Key, path: '/admin/licenses' },
  { label: 'Billing', icon: CreditCard, path: '/admin/billing' },
  { label: 'Costs', icon: Server, path: '/admin/costs' },
  { label: 'AI Costs', icon: Brain, path: '/admin/ai-costs' },
  { label: 'Activity', icon: Activity, path: '/admin/activity' },
  { label: 'Support Tickets', icon: Contact, path: '/admin/support' },
  { label: 'Settings', icon: Settings, path: '/admin/settings' },
];

interface AdminSidebarProps {
  onNavigate?: () => void;
}

const AdminSidebar = ({ onNavigate }: AdminSidebarProps) => {
  const location = useLocation();

  return (
    <aside className="flex h-screen w-64 flex-col bg-foreground text-primary-foreground">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-primary-foreground/10">
        <img src={logo} alt="GoToSpecialClass logo" className="h-9 w-9 rounded-lg object-cover" />
        <div>
          <h1 className="text-sm font-bold leading-tight">Admin Console</h1>
          <p className="text-[11px] opacity-50">Specialist Ops!</p>
        </div>
      </div>

      {/* Back to portal */}
      <div className="px-3 pt-4 pb-2">
        <Link
          to="/app/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium opacity-60 hover:opacity-100 transition-opacity"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Portal
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {adminNavItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-foreground/15 text-primary-foreground'
                  : 'text-primary-foreground/60 hover:bg-primary-foreground/10 hover:text-primary-foreground/90'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};

export default AdminSidebar;
