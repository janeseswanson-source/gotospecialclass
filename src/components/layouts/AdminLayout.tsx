import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import Topbar from './Topbar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

const AdminLayout = () => {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {!isMobile && <AdminSidebar />}

      {isMobile && (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-64 p-0 bg-foreground border-none">
            <AdminSidebar onNavigate={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar isAdmin onMenuToggle={() => setSidebarOpen(true)} showMenu={isMobile} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
