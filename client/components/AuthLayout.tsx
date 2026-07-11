import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, LogOut, LayoutDashboard, BookOpen, Calendar, MessageSquare, Bell as BellIcon, User } from "lucide-react";

interface AuthLayoutProps {
  children: ReactNode;
  userRole: "student" | "faculty" | "admin";
  userName: string;
}

export default function AuthLayout({ children, userRole, userName }: AuthLayoutProps) {
  const location = useLocation();

  const navItems = {
    student: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/student" },
      { label: "Book Session", icon: BookOpen, path: "/student/book" },
      { label: "My Schedule", icon: Calendar, path: "/student/schedule" },
      { label: "AI Assistant", icon: MessageSquare, path: "/student/ai" },
      { label: "Notification", icon: BellIcon, path: "/student/notifications" },
      { label: "Profile", icon: User, path: "/student/profile" },
    ],
    faculty: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/faculty" },
      { label: "Requests", icon: BookOpen, path: "/faculty/requests" },
      { label: "Availability", icon: Calendar, path: "/faculty/availability" },
      { label: "Profile", icon: User, path: "/faculty/profile" },
    ],
    admin: [
      { label: "Dashboard", icon: LayoutDashboard, path: "/admin" },
      { label: "Users", icon: User, path: "/admin/users" },
      { label: "Schedules", icon: Calendar, path: "/admin/schedules" },
      { label: "Manage Chatbot", icon: MessageSquare, path: "/admin/chatbot" },
      { label: "Reports", icon: LayoutDashboard, path: "/admin/reports" },
    ],
  };

  const items = navItems[userRole];

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <div className="w-56 bg-primary text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-primary/20">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
              <span className="text-primary font-bold text-lg">C</span>
            </div>
            <span className="font-bold text-lg">Consult</span>
          </Link>
        </div>

        {/* User Info */}
        <div className="p-4 border-b border-primary/20">
          <div className="text-sm">
            <p className="font-semibold">{userName}</p>
            <p className="text-primary/80 text-xs capitalize">{userRole}</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          {items.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-secondary text-primary"
                    : "text-white hover:bg-primary/80"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Sign Out */}
        <div className="p-4 border-t border-primary/20">
          <Link
            to="/"
            className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-white hover:bg-primary/80 rounded-lg transition-colors"
          >
            <LogOut size={18} />
            Sign out
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-white border-b border-border h-16 flex items-center justify-between px-6">
          <div />
          <div className="flex items-center gap-4">
            <button className="relative p-2 hover:bg-muted rounded-lg transition-colors">
              <Bell size={20} className="text-foreground" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
