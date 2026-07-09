import { useState } from "react";
import { Link } from "react-router-dom";
import { Send, MessageSquare, Star, Clock, CheckCircle, Settings, LogOut, Bell, MessageCircle } from "lucide-react";

interface Message {
  id: string;
  type: "user" | "bot";
  content: string;
  timestamp: Date;
}

interface FacultyCard {
  id: string;
  name: string;
  department: string;
  expertise: string[];
  rating: number;
  responseTime: string;
  availability: string[];
}

export default function StudentDashboard() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "bot",
      content: "Hello! I'm the CLIRDEC AI Assistant. Tell me what academic help you need, and I'll match you with the right faculty expert.",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [selectedFaculty, setSelectedFaculty] = useState<FacultyCard | null>(null);
  const [showFacultyList, setShowFacultyList] = useState(false);

  // Sample faculty data
  const matchedFaculty: FacultyCard[] = [
    {
      id: "1",
      name: "Dr. Maria Santos",
      department: "CICS",
      expertise: ["OOP", "Java", "Software Design"],
      rating: 4.8,
      responseTime: "2 hours avg",
      availability: ["Mon 2-4 PM", "Wed 3-5 PM", "Fri 1-3 PM"],
    },
    {
      id: "2",
      name: "Prof. Juan Dela Cruz",
      department: "CICS",
      expertise: ["Web Development", "PHP", "Laravel"],
      rating: 4.6,
      responseTime: "3 hours avg",
      availability: ["Tue 1-3 PM", "Thu 2-4 PM"],
    },
    {
      id: "3",
      name: "Dr. Ana Reyes",
      department: "CICS",
      expertise: ["Databases", "SQL", "Data Structures"],
      rating: 4.9,
      responseTime: "1 hour avg",
      availability: ["Mon 3-5 PM", "Wed 1-3 PM", "Thu 3-5 PM"],
    },
  ];

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    setInputValue("");

    // Simulate bot response
    setTimeout(() => {
      const botResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: "bot",
        content: "I found 3 faculty members who can help with your request. They're shown below. Would you like to book a consultation?",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botResponse]);
      setShowFacultyList(true);
    }, 800);
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
          <div className="flex items-center gap-6">
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
        <div className="grid lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
          {/* Main Chat Area */}
          <div className="lg:col-span-2 flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden">
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-xs lg:max-w-md rounded-lg px-4 py-3 ${
                    msg.type === "user"
                      ? "bg-primary text-white rounded-br-none"
                      : "bg-slate-100 text-slate-900 rounded-bl-none"
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                    <p className={`text-xs mt-1 ${msg.type === "user" ? "text-primary/70" : "text-slate-500"}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}

              {/* Faculty Cards in Chat */}
              {showFacultyList && (
                <div className="space-y-3 my-4">
                  {matchedFaculty.map(faculty => (
                    <button
                      key={faculty.id}
                      onClick={() => setSelectedFaculty(faculty)}
                      className="w-full text-left p-4 rounded-lg border-2 border-slate-200 hover:border-primary hover:shadow-md transition-all bg-white"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-semibold text-slate-900">{faculty.name}</h4>
                          <p className="text-xs text-slate-500">{faculty.department}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star size={16} className="text-yellow-500 fill-yellow-500" />
                          <span className="text-sm font-semibold">{faculty.rating}</span>
                        </div>
                      </div>
                      <div className="mb-3">
                        <div className="flex flex-wrap gap-2">
                          {faculty.expertise.map(tag => (
                            <span key={tag} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span className="flex items-center gap-1"><Clock size={14} /> {faculty.responseTime}</span>
                        <span className="text-primary font-semibold">View Details →</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="border-t border-slate-200 p-4 bg-slate-50">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyPress={e => e.key === "Enter" && handleSendMessage()}
                  placeholder="Describe your academic need..."
                  className="flex-1 px-4 py-3 rounded-lg border border-slate-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                />
                <button
                  onClick={handleSendMessage}
                  className="px-6 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  <Send size={18} />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Upcoming Consultations */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Clock size={20} className="text-primary" />
                Upcoming Consultations
              </h3>
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="font-semibold text-slate-900 text-sm">Dr. Maria Santos</p>
                  <p className="text-xs text-slate-600 mt-1">Wednesday, 2:30 PM</p>
                  <p className="text-xs text-slate-600">OOP Consultation</p>
                  <div className="flex gap-2 mt-3">
                    <button className="flex-1 px-2 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 transition-colors">
                      Join
                    </button>
                    <button className="flex-1 px-2 py-1 bg-slate-200 text-slate-900 rounded text-xs font-medium hover:bg-slate-300 transition-colors">
                      Reschedule
                    </button>
                  </div>
                </div>
              </div>
              <button className="w-full mt-4 px-4 py-2 border border-slate-200 text-slate-900 rounded-lg font-medium hover:bg-slate-50 transition-colors text-sm">
                View All
              </button>
            </div>

            {/* Recent Consultations */}
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <CheckCircle size={20} className="text-primary" />
                Recent Sessions
              </h3>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-medium text-slate-900 text-sm">Prof. Juan Dela Cruz</p>
                    <div className="flex items-center gap-1">
                      <Star size={14} className="text-yellow-500 fill-yellow-500" />
                      <span className="text-xs font-semibold">4.5</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">Laravel Framework Discussion</p>
                  <p className="text-xs text-slate-500 mt-1">2 days ago</p>
                  <button className="text-xs text-primary font-semibold mt-2 hover:underline">
                    View Feedback →
                  </button>
                </div>
              </div>
            </div>

            {/* Selected Faculty Details */}
            {selectedFaculty && (
              <div className="bg-white rounded-lg border border-slate-200 p-6">
                <button
                  onClick={() => setSelectedFaculty(null)}
                  className="text-xs text-slate-500 hover:text-slate-900 mb-4"
                >
                  ← Back
                </button>
                <div className="mb-4">
                  <h4 className="font-semibold text-slate-900">{selectedFaculty.name}</h4>
                  <p className="text-sm text-slate-600">{selectedFaculty.department}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <Star size={16} className="text-yellow-500 fill-yellow-500" />
                    <span className="font-semibold">{selectedFaculty.rating}</span>
                  </div>
                </div>
                <div className="mb-4">
                  <p className="text-xs font-medium text-slate-500 mb-2">EXPERTISE</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedFaculty.expertise.map(tag => (
                      <span key={tag} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mb-4 pb-4 border-b border-slate-200">
                  <p className="text-xs font-medium text-slate-500 mb-2">AVAILABILITY</p>
                  <div className="space-y-2">
                    {selectedFaculty.availability.map(slot => (
                      <button
                        key={slot}
                        className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-primary hover:bg-primary/5 transition-colors text-sm"
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="w-full px-4 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                  <MessageCircle size={18} />
                  Book Consultation
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
