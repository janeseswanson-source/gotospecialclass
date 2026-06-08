import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import Topbar from './Topbar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { SchoolProvider } from '@/contexts/SchoolContext';

const AppLayout = () => {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <SchoolProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Desktop sidebar */}
        {!isMobile && <AppSidebar />}

        {/* Mobile sidebar drawer */}
        {isMobile && (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar border-none">
              <AppSidebar onNavigate={() => setSidebarOpen(false)} />
            </SheetContent>
          </Sheet>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar onMenuToggle={() => setSidebarOpen(true)} showMenu={isMobile} />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SchoolProvider>
  );
};

export default AppLayout;
