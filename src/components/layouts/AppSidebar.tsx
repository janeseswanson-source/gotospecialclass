import { useLocation, Link } from 'react-router-dom';
import logo from '@/assets/logo.png';
import {
  LayoutDashboard, Wand2, CalendarDays, Users, Download,
  CreditCard, Settings, LogOut, School, HelpCircle, ClipboardList, NotebookPen, LayoutGrid
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { cn } from '@/lib/utils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/app/dashboard' },
  { label: 'Schools', icon: School, path: '/app/schools' },
  { label: 'Setup Wizard', icon: Wand2, path: '/app/setup' },
  { label: 'Master Schedule', icon: CalendarDays, path: '/app/schedule' },
  { label: 'Master Admin View', icon: LayoutGrid, path: '/app/admin-view' },
  { label: 'Specialist Planner', icon: Users, path: '/app/planner' },
  { label: 'Lesson Planner', icon: NotebookPen, path: '/app/lesson-planner' },
  { label: 'Exports', icon: Download, path: '/app/exports' },
  { label: 'Billing / License', icon: CreditCard, path: '/app/billing' },
  { label: 'Settings', icon: Settings, path: '/app/settings' },
  { label: 'Help', icon: HelpCircle, path: '/app/help' },
];

interface AppSidebarProps {
  onNavigate?: () => void;
}

const AppSidebar = ({ onNavigate }: AppSidebarProps) => {
  const location = useLocation();
  const { signOut } = useAuth();
  const { schools, selectedSchoolId, setSelectedSchoolId, loading } = useSchool();

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-sidebar-border">
        <img src={logo} alt="GoToSpecialClass logo" className="h-9 w-9 rounded-lg object-cover" />
        <div>
          <h1 className="text-sm font-bold leading-tight">Specialist Ops!</h1>
          <p className="text-[11px] opacity-70">Scheduler</p>
        </div>
      </div>

      {/* School Switcher */}
      {!loading && schools.length > 0 && (
        <div className="px-3 pt-3 pb-1">
          <Select value={selectedSchoolId ?? ''} onValueChange={setSelectedSchoolId}>
            <SelectTrigger className="w-full bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground text-xs h-9">
              <div className="flex items-center gap-2 truncate">
                <School className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <SelectValue placeholder="Select school" />
              </div>
            </SelectTrigger>
            <SelectContent>
              {schools.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  <span className="flex items-center gap-2">
                    {s.name}
                    {s.is_demo && <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent">Demo</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
