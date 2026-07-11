import { useEffect, useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { Clock, BookOpen, Users, TrendingUp } from "lucide-react";

export default function StudentDashboard() {
  const [currentTime, setCurrentTime] = useState<string>("");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setCurrentTime("Good Morning");
    else if (hour < 18) setCurrentTime("Good Afternoon");
    else setCurrentTime("Good Evening");
  }, []);

  const stats = [
    { label: "Sessions this month", value: "6" },
    { label: "Hours studied", value: "7" },
    { label: "Faculty engaged", value: "3" },
  ];

  const upcomingConsultations = [
    {
      id: 1,
      subject: "Calculus",
      faculty: "Dr. Amara Ose",
      time: "Today 3pm",
      location: "Faculty room",
    },
    {
      id: 2,
      subject: "Calculus",
      faculty: "Dr. Amara Ose",
      time: "Today 3pm",
      location: "Faculty room",
    },
    {
      id: 3,
      subject: "Calculus",
      faculty: "Dr. Amara Ose",
      time: "Today 3pm",
      location: "Faculty room",
    },
  ];

  const recentSessions = [
    {
      id: 1,
      subject: "Calculus",
      location: "Faculty room",
      time: "3pm Today",
      status: "upcoming",
    },
    {
      id: 2,
      subject: "Calculus",
      location: "Faculty room",
      time: "3pm Today",
      status: "upcoming",
    },
  ];

  return (
    <AuthLayout userRole="student" userName="Sofia Navaro">
      <div className="p-8 space-y-8">
        {/* Greeting */}
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">{currentTime}</h1>
          <p className="text-gray-600">Welcome back to your dashboard</p>
        </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {stats.map((stat, idx) => (
            <div key={idx} className="p-6 bg-white border border-gray-200 rounded">
              <p className="text-2xl font-bold text-green-700 mb-2">{stat.value}</p>
              <p className="text-sm text-gray-600">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Upcoming Consultations */}
          <div className="lg:col-span-2">
            <div className="bg-white border border-gray-200 rounded p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Upcoming Consultations</h2>
              <div className="space-y-4">
                {upcomingConsultations.map(consultation => (
                  <div key={consultation.id} className="p-4 border border-gray-200 rounded hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-900">{consultation.subject}</h3>
                        <p className="text-sm text-gray-600">{consultation.faculty}</p>
                      </div>
                    </div>
                    <div className="flex gap-6 text-sm text-gray-600">
                      <span>{consultation.time}</span>
                      <span>{consultation.location}</span>
                    </div>
                  </div>
                ))}
              </div>
              <button className="mt-6 w-full px-4 py-2 border border-gray-300 text-gray-900 rounded font-medium hover:bg-gray-50 transition-colors">
                View All
              </button>
            </div>
          </div>

          {/* Recent Sessions */}
          <div>
            <div className="bg-white border border-gray-200 rounded p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Recent Sessions</h2>
              <div className="space-y-4">
                {recentSessions.map(session => (
                  <div key={session.id} className="p-4 bg-gray-50 border border-gray-200 rounded">
                    <h3 className="font-semibold text-gray-900 text-sm">{session.subject}</h3>
                    <p className="text-xs text-gray-600 mt-1">{session.location}</p>
                    <p className="text-xs text-gray-600">{session.time}</p>
                    <span className="inline-block mt-2 px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded">
                      {session.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
