import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { Search, Star } from "lucide-react";

interface Faculty {
  id: string;
  name: string;
  subject: string;
  rating: number;
  reviews: number;
  availability: string[];
}

export default function BookSession() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFaculty, setSelectedFaculty] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const faculty: Faculty[] = [
    {
      id: "1",
      name: "Dr. Amara Ose",
      subject: "Calculus",
      rating: 4.9,
      reviews: 298,
      availability: ["Mon 10am", "Wed 2pm", "Fri 11am"],
    },
    {
      id: "2",
      name: "Dr. Amara Ose",
      subject: "Calculus",
      rating: 4.9,
      reviews: 298,
      availability: ["Mon 10am", "Wed 2pm", "Fri 11am"],
    },
    {
      id: "3",
      name: "Dr. Amara Ose",
      subject: "Calculus",
      rating: 4.9,
      reviews: 298,
      availability: ["Mon 10am", "Wed 2pm", "Fri 11am"],
    },
    {
      id: "4",
      name: "Dr. Amara Ose",
      subject: "Calculus",
      rating: 4.9,
      reviews: 298,
      availability: ["Mon 10am", "Wed 2pm", "Fri 11am"],
    },
    {
      id: "5",
      name: "Dr. Amara Ose",
      subject: "Calculus",
      rating: 4.9,
      reviews: 298,
      availability: ["Mon 10am", "Wed 2pm", "Fri 11am"],
    },
    {
      id: "6",
      name: "Dr. Amara Ose",
      subject: "Calculus",
      rating: 4.9,
      reviews: 298,
      availability: ["Mon 10am", "Wed 2pm", "Fri 11am"],
    },
  ];

  const filteredFaculty = faculty.filter(f =>
    f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.subject.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (selectedFaculty && selectedSlot) {
    return (
      <AuthLayout userRole="student" userName="Sofia Navaro">
        <div className="p-8">
          <div className="max-w-2xl mx-auto">
            {/* Confirmation Dialog */}
            <div className="bg-white border border-gray-200 rounded p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
                <span className="text-3xl">✓</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Booking Confirmed</h2>
              <p className="text-gray-600 mb-6">
                Session with <strong>Dr. Amara Osei</strong> on <strong>Wed 2pm</strong> is confirmed.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-6">
                <p className="font-semibold text-gray-900">FACULTY ROOM</p>
                <p className="text-sm text-gray-600">CLIRDEC</p>
              </div>
              <button
                onClick={() => {
                  setSelectedFaculty(null);
                  setSelectedSlot(null);
                }}
                className="px-6 py-2 bg-gray-200 text-gray-900 rounded font-semibold hover:bg-gray-300 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (selectedFaculty) {
    return (
      <AuthLayout userRole="student" userName="Sofia Navaro">
        <div className="p-8">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={() => setSelectedFaculty(null)}
              className="text-sm text-gray-600 hover:text-gray-900 mb-6"
            >
              ← Back
            </button>

            {/* Booking Modal */}
            <div className="bg-white border border-gray-200 rounded p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Book A Session</h2>

              <div className="mb-6 p-4 border border-gray-200 rounded">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded bg-gray-300"></div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Dr. Amara Ose</h3>
                    <p className="text-sm text-gray-600">Calculus</p>
                  </div>
                </div>
              </div>

              <div className="mb-6 p-4 border border-gray-200 rounded">
                <p className="text-sm font-semibold text-gray-600 mb-2">IN-PERSON LOCATION</p>
                <p className="font-semibold text-gray-900">FACULTY ROOM</p>
                <p className="text-sm text-gray-600">CLIRDEC</p>
              </div>

              <div className="mb-6">
                <p className="text-sm font-semibold text-gray-600 mb-3">SELECT A TIME SLOT</p>
                <div className="grid grid-cols-3 gap-3">
                  {["MON 10am", "WED 2pm", "FRI 11am"].map(slot => (
                    <button
                      key={slot}
                      onClick={() => setSelectedSlot(slot)}
                      className={`px-4 py-2 rounded font-medium transition-colors ${
                        selectedSlot === slot
                          ? "bg-gray-900 text-white"
                          : "border border-gray-300 text-gray-900 hover:border-gray-400"
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setSelectedSlot("WED 2pm")}
                className="w-full px-4 py-3 bg-gray-900 text-white rounded font-semibold hover:bg-gray-800 transition-colors"
              >
                Confirm Booking
              </button>
            </div>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout userRole="student" userName="Sofia Navaro">
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Book Consultation</h1>

        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search by name, subject, topic..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded focus:outline-none focus:border-green-700"
            />
          </div>
        </div>

        {/* Faculty Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredFaculty.map(f => (
            <button
              key={f.id}
              onClick={() => setSelectedFaculty(f.id)}
              className="p-6 border border-gray-200 rounded hover:shadow-lg transition-all text-left bg-white"
            >
              <div className="w-full h-32 bg-gray-300 rounded mb-4"></div>
              <h3 className="font-semibold text-gray-900">{f.name}</h3>
              <p className="text-sm text-gray-600 mb-3">{f.subject}</p>
              <div className="flex items-center gap-2 mb-4">
                <Star size={16} className="text-yellow-500 fill-yellow-500" />
                <span className="font-semibold text-sm">{f.rating}</span>
                <span className="text-xs text-gray-600">({f.reviews} reviews)</span>
              </div>
              <button className="w-full px-4 py-2 bg-gray-900 text-white rounded font-medium hover:bg-gray-800 transition-colors text-sm">
                Book Session
              </button>
            </button>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
