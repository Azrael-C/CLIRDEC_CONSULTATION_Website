import { useState } from "react";
import { Link } from "react-router-dom";
import { Settings, LogOut, Bell, TrendingUp, Users, Clock, Star, Search } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface Analytics {
  avgResponseTime: string;
  totalBookings: number;
  departmentSatisfaction: number;
  noShowRate: number;
}

interface FacultyMetric {
  name: string;
  department: string;
  consultations: number;
  rating: number;
  responseTime: string;
}

interface FeedbackEntry {
  id: string;
  date: string;
  college: string;
  topic: string;
  rating: number;
  status: string;
}

export default function AdminDashboard() {
  const [searchTerm, setSearchTerm] = useState("");

  const analytics: Analytics = {
    avgResponseTime: "2.3 hours",
    totalBookings: 342,
    departmentSatisfaction: 4.7,
    noShowRate: 3.2,
  };

  const consultationsPerDay = [
    { day: "Mon", consultations: 12 },
    { day: "Tue", consultations: 18 },
    { day: "Wed", consultations: 15 },
    { day: "Thu", consultations: 22 },
    { day: "Fri", consultations: 18 },
    { day: "Sat", consultations: 5 },
    { day: "Sun", consultations: 2 },
  ];

  const facultyMetrics: FacultyMetric[] = [
    {
      name: "Dr. Maria Santos",
      department: "CICS",
      consultations: 48,
      rating: 4.9,
      responseTime: "1.2 hours",
    },
    {
      name: "Prof. Juan Dela Cruz",
      department: "CICS",
      consultations: 35,
      rating: 4.6,
      responseTime: "2.1 hours",
    },
    {
      name: "Dr. Ana Reyes",
      department: "CICS",
      consultations: 42,
      rating: 4.8,
      responseTime: "1.5 hours",
    },
    {
      name: "Prof. Miguel Torres",
      department: "COE",
      consultations: 28,
      rating: 4.5,
      responseTime: "3.2 hours",
    },
    {
      name: "Dr. Rosa Santos",
      department: "CAB",
      consultations: 31,
      rating: 4.7,
      responseTime: "2.8 hours",
    },
  ];

  const feedbackLog: FeedbackEntry[] = [
    {
      id: "1",
      date: "2024-01-15",
      college: "CICS",
      topic: "Object-Oriented Programming",
      rating: 5,
      status: "Completed",
    },
    {
      id: "2",
      date: "2024-01-15",
      college: "COE",
      topic: "Structural Engineering",
      rating: 4,
      status: "Completed",
    },
    {
      id: "3",
      date: "2024-01-14",
      college: "CICS",
      topic: "Web Development",
      rating: 5,
      status: "Completed",
    },
    {
      id: "4",
      date: "2024-01-14",
      college: "CAB",
      topic: "Plant Biology",
      rating: 3,
      status: "Completed",
    },
    {
      id: "5",
      date: "2024-01-13",
      college: "CICS",
      topic: "Database Design",
      rating: 5,
      status: "Completed",
    },
  ];

  const filteredFeedback = feedbackLog.filter(entry =>
    entry.college.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.topic.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="font-bold text-slate-900">CLIRDEC</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <p className="font-semibold text-slate-900 text-sm">Dean of CICS</p>
              <p className="text-xs text-slate-500">Administrator</p>
            </div>
            <button className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
              <Bell size={20} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <button className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
              <Settings size={20} />
            </button>
            <Link to="/" className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
              <LogOut size={20} />
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Analytics Dashboard</h1>
          <p className="text-slate-600 mt-1">Department-wide consultation metrics and performance indicators</p>
        </div>

        {/* KPI Scorecards */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-slate-600">Avg. Response Time</p>
              <Clock className="text-primary" size={20} />
            </div>
            <p className="text-3xl font-bold text-slate-900">{analytics.avgResponseTime}</p>
            <p className="text-xs text-slate-500 mt-2">Average time to respond to booking requests</p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-slate-600">Total Bookings</p>
              <Users className="text-primary" size={20} />
            </div>
            <p className="text-3xl font-bold text-slate-900">{analytics.totalBookings}</p>
            <p className="text-xs text-slate-500 mt-2">Total consultations this semester</p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-slate-600">Department Satisfaction</p>
              <Star className="text-primary fill-primary" size={20} />
            </div>
            <p className="text-3xl font-bold text-slate-900">{analytics.departmentSatisfaction}/5</p>
            <p className="text-xs text-slate-500 mt-2">Average satisfaction rating</p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-slate-600">No-Show Rate</p>
              <TrendingUp className="text-red-500" size={20} />
            </div>
            <p className="text-3xl font-bold text-slate-900">{analytics.noShowRate}%</p>
            <p className="text-xs text-slate-500 mt-2">Percentage of missed appointments</p>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid lg:grid-cols-3 gap-6 mb-8">
          {/* Consultations Per Day Chart */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-6">Consultations Per Day</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={consultationsPerDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "#f1f5f9" }}
                />
                <Bar dataKey="consultations" fill="#7c3aed" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Department Breakdown */}
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-6">Department Breakdown</h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium text-slate-900">CICS</p>
                  <p className="text-sm font-semibold text-primary">145</p>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-primary rounded-full h-2" style={{ width: "65%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium text-slate-900">COE</p>
                  <p className="text-sm font-semibold text-primary">98</p>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-primary rounded-full h-2" style={{ width: "44%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium text-slate-900">CAB</p>
                  <p className="text-sm font-semibold text-primary">74</p>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-primary rounded-full h-2" style={{ width: "33%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium text-slate-900">CAS</p>
                  <p className="text-sm font-semibold text-primary">25</p>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="bg-primary rounded-full h-2" style={{ width: "11%" }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Faculty Rankings */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-6">Faculty Performance Rankings</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Faculty Name</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Department</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Consultations</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Rating</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Response Time</th>
                </tr>
              </thead>
              <tbody>
                {facultyMetrics.map((faculty, index) => (
                  <tr key={index} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4 text-sm font-medium text-slate-900">{faculty.name}</td>
                    <td className="py-4 px-4 text-sm text-slate-600">{faculty.department}</td>
                    <td className="py-4 px-4 text-sm text-slate-900 font-semibold">{faculty.consultations}</td>
                    <td className="py-4 px-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Star size={16} className="text-yellow-500 fill-yellow-500" />
                        <span className="font-semibold">{faculty.rating}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm text-slate-600">{faculty.responseTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Feedback Log */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-6">Feedback Log</h2>

          {/* Search */}
          <div className="mb-6 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search by college or topic..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 text-sm"
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">College</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Topic</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Rating</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-900 text-sm">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredFeedback.map(entry => (
                  <tr key={entry.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4 text-sm text-slate-900">{entry.date}</td>
                    <td className="py-4 px-4 text-sm text-slate-900 font-medium">{entry.college}</td>
                    <td className="py-4 px-4 text-sm text-slate-600">{entry.topic}</td>
                    <td className="py-4 px-4 text-sm">
                      <div className="flex items-center gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            size={14}
                            className={i < entry.rating ? "text-yellow-500 fill-yellow-500" : "text-slate-300"}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm">
                      <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold text-xs">
                        {entry.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredFeedback.length === 0 && (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm">No feedback entries found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
