import AuthLayout from "@/components/AuthLayout";
import { Mail } from "lucide-react";

export default function Notifications() {
  const notifications = [
    {
      id: "1",
      title: "Session confirmed",
      message: "Your session with Dr. Amara Osei is today at 3: 00 PM has been confirmed",
      time: "Just now",
      read: false,
    },
    {
      id: "2",
      title: "Session in 2 hours",
      message: "Reminder: Calculus session with Dr. Osei at 3:00 PM in Room 214",
      time: "1hr ago",
      read: false,
    },
    {
      id: "3",
      title: "Session confirmed",
      message: "Your session with Dr. Amara Osei is today at 3: 00 PM has been confirmed",
      time: "Just now",
      read: true,
    },
    {
      id: "4",
      title: "Session confirmed",
      message: "Your session with Dr. Amara Osei is today at 3: 00 PM has been confirmed",
      time: "Just now",
      read: true,
    },
  ];

  return (
    <AuthLayout userRole="student" userName="Sofia Navaro">
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Notifications</h1>
        <p className="text-gray-600 mb-8">2 unread</p>

        <div className="space-y-2">
          {notifications.map(notification => (
            <div
              key={notification.id}
              className={`p-6 border border-gray-200 rounded flex gap-4 ${
                !notification.read ? "bg-blue-50" : ""
              }`}
            >
              <Mail size={20} className="text-gray-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">{notification.title}</h3>
                <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                <p className="text-xs text-gray-500 mt-2">{notification.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
