import { useState } from "react";
import { Link } from "react-router-dom";
import { Settings, LogOut, Bell, X, Plus, Clock, MessageSquare, BarChart3 } from "lucide-react";

interface TimeSlot {
  day: string;
  startTime: string;
  endTime: string;
  status: "available" | "booked" | "closed";
}

export default function FacultyDashboard() {
  const [bio, setBio] = useState("Specializing in object-oriented programming and software design patterns. 15+ years of teaching experience.");
  const [expertise, setExpertise] = useState(["OOP", "Java", "Software Design", "Design Patterns"]);
  const [newTag, setNewTag] = useState("");
  const [showAddTag, setShowAddTag] = useState(false);
  const [schedule, setSchedule] = useState<TimeSlot[]>([
    { day: "Monday", startTime: "09:00", endTime: "12:00", status: "available" },
    { day: "Monday", startTime: "14:00", endTime: "17:00", status: "available" },
    { day: "Tuesday", startTime: "10:00", endTime: "13:00", status: "booked" },
    { day: "Tuesday", startTime: "14:00", endTime: "17:00", status: "available" },
    { day: "Wednesday", startTime: "09:00", endTime: "12:00", status: "available" },
    { day: "Wednesday", startTime: "14:00", endTime: "17:00", status: "available" },
    { day: "Thursday", startTime: "10:00", endTime: "13:00", status: "available" },
    { day: "Thursday", startTime: "15:00", endTime: "18:00", status: "booked" },
    { day: "Friday", startTime: "09:00", endTime: "12:00", status: "available" },
    { day: "Friday", startTime: "14:00", endTime: "17:00", status: "available" },
  ]);

  const upcomingConsultations = [
    {
      id: "1",
      studentName: "John Ramos",
      topic: "Object-Oriented Programming",
      dateTime: "Today, 2:30 PM",
      status: "scheduled",
    },
    {
      id: "2",
      studentName: "Maria Garcia",
      topic: "Design Patterns",
      dateTime: "Tomorrow, 10:00 AM",
      status: "scheduled",
    },
    {
      id: "3",
      studentName: "Carlos Lopez",
      topic: "Java Best Practices",
      dateTime: "Wed, 3:00 PM",
      status: "scheduled",
    },
  ];

  const handleAddTag = () => {
    if (newTag.trim()) {
      setExpertise([...expertise, newTag]);
      setNewTag("");
      setShowAddTag(false);
    }
  };

  const handleRemoveTag = (tag: string) => {
    setExpertise(expertise.filter(t => t !== tag));
  };

  const toggleSlotStatus = (index: number) => {
    const newSchedule = [...schedule];
    const statuses = ["available", "booked", "closed"];
    const currentIndex = statuses.indexOf(newSchedule[index].status);
    newSchedule[index].status = statuses[(currentIndex + 1) % statuses.length] as any;
    setSchedule(newSchedule);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available":
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "booked":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "closed":
        return "bg-slate-100 text-slate-700 border-slate-200";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

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
              <p className="font-semibold text-slate-900 text-sm">Dr. Maria Santos</p>
              <p className="text-xs text-slate-500">Faculty Member</p>
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
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Profile Section */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Your Profile</h2>

              {/* Bio */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-slate-900 mb-2">Bio</label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all resize-none"
                  placeholder="Write a brief bio about yourself..."
                />
                <p className="text-xs text-slate-500 mt-2">{bio.length}/500 characters</p>
              </div>

              {/* Expertise Tags */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-3">Area of Expertise</label>
                <div className="flex flex-wrap gap-2 mb-4">
                  {expertise.map(tag => (
                    <div
                      key={tag}
                      className="px-3 py-2 bg-primary/10 text-primary rounded-lg font-medium text-sm flex items-center gap-2"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-primary/70 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                {!showAddTag ? (
                  <button
                    onClick={() => setShowAddTag(true)}
                    className="px-3 py-2 border border-slate-200 text-slate-900 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors flex items-center gap-2"
                  >
                    <Plus size={16} />
                    Add Expertise
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyPress={e => e.key === "Enter" && handleAddTag()}
                      placeholder="e.g., React, TypeScript, Node.js"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:border-primary focus:outline-none text-sm"
                    />
                    <button
                      onClick={handleAddTag}
                      className="px-4 py-2 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setShowAddTag(false);
                        setNewTag("");
                      }}
                      className="px-4 py-2 bg-slate-100 text-slate-900 rounded-lg font-medium text-sm hover:bg-slate-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Weekly Schedule */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Weekly Schedule</h2>
              <p className="text-sm text-slate-600 mb-6">Click on a time slot to toggle availability. Students can only book available slots.</p>

              <div className="space-y-3">
                {schedule.map((slot, index) => (
                  <div
                    key={index}
                    onClick={() => toggleSlotStatus(index)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${getStatusColor(slot.status)}`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-semibold">{slot.day}</p>
                        <p className="text-sm">{slot.startTime} - {slot.endTime}</p>
                      </div>
                      <div className="text-sm font-semibold capitalize">{slot.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Quick Stats</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Total Consultations</p>
                  <p className="text-3xl font-bold text-primary">24</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Avg. Rating</p>
                  <p className="text-3xl font-bold text-primary">4.8/5</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">This Week</p>
                  <p className="text-3xl font-bold text-primary">5</p>
                  <p className="text-xs text-slate-500">scheduled consultations</p>
                </div>
              </div>
              <button className="w-full mt-4 px-4 py-2 border border-slate-200 text-slate-900 rounded-lg font-medium hover:bg-slate-50 transition-colors text-sm flex items-center justify-center gap-2">
                <BarChart3 size={18} />
                View Analytics
              </button>
            </div>

            {/* Upcoming Consultations */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Clock size={20} className="text-primary" />
                Upcoming Sessions
              </h3>
              <div className="space-y-3">
                {upcomingConsultations.map(consultation => (
                  <div key={consultation.id} className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                    <p className="font-semibold text-slate-900 text-sm">{consultation.studentName}</p>
                    <p className="text-xs text-slate-600 mt-1">{consultation.topic}</p>
                    <p className="text-xs text-slate-500 mt-1">{consultation.dateTime}</p>
                    <div className="flex gap-2 mt-3">
                      <button className="flex-1 px-2 py-1 bg-primary text-white rounded text-xs font-medium hover:bg-primary/90 transition-colors">
                        Start Session
                      </button>
                      <button className="flex-1 px-2 py-1 bg-slate-200 text-slate-900 rounded text-xs font-medium hover:bg-slate-300 transition-colors">
                        Reschedule
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button className="w-full mt-4 px-4 py-2 border border-slate-200 text-slate-900 rounded-lg font-medium hover:bg-slate-50 transition-colors text-sm">
                View All Sessions
              </button>
            </div>

            {/* Messages */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <MessageSquare size={20} className="text-primary" />
                Messages
              </h3>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="font-semibold text-slate-900 text-sm">John Ramos</p>
                  <p className="text-xs text-slate-600 mt-1">Can we reschedule to tomorrow?</p>
                  <p className="text-xs text-slate-500 mt-1">5 minutes ago</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
