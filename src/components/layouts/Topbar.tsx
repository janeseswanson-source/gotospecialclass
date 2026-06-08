import { Menu, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import NotificationDropdown from '@/components/notifications/NotificationDropdown';

interface TopbarProps {
  isAdmin?: boolean;
  onMenuToggle?: () => void;
  showMenu?: boolean;
}

const Topbar = ({ isAdmin = false, onMenuToggle, showMenu = false }: TopbarProps) => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 md:px-6">
      <div className="flex items-center gap-3">
        {showMenu && (
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onMenuToggle}>
            <Menu className="h-5 w-5" />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 md:gap-4">
        {isAdmin && (
          <span className="rounded-md bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">
            ADMIN
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="text-muted-foreground"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <NotificationDropdown />
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {user?.email?.charAt(0).toUpperCase() || 'U'}
        </div>
      </div>
    </header>
  );
};

export default Topbar;
