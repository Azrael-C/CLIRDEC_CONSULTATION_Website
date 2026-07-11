import AuthLayout from "@/components/AuthLayout";

export default function MySchedule() {
  const consultations = [
    {
      id: "1",
      subject: "Calculus",
      faculty: "Dr. Amara Ose",
      time: "Today 3pm",
      status: "Upcoming",
    },
    {
      id: "2",
      subject: "Calculus",
      faculty: "Dr. Amara Ose",
      time: "Today 3pm",
      status: "Upcoming",
    },
  ];

  return (
    <AuthLayout userRole="student" userName="Sofia Navaro">
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Appointment Schedule</h1>

        {/* Tabs */}
        <div className="mb-8 flex gap-4 border-b border-gray-200">
          <button className="px-4 py-2 font-semibold text-gray-900 border-b-2 border-gray-900">
            All
          </button>
          <button className="px-4 py-2 font-semibold text-gray-600 hover:text-gray-900">
            Upcoming
          </button>
          <button className="px-4 py-2 font-semibold text-gray-600 hover:text-gray-900">
            Completed
          </button>
        </div>

        {/* Consultations List */}
        <div className="space-y-4">
          {consultations.map(consultation => (
            <div key={consultation.id} className="p-6 border border-gray-200 rounded">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{consultation.subject}</h3>
                  <p className="text-sm text-gray-600">{consultation.faculty}</p>
                </div>
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm font-semibold rounded">
                  {consultation.status}
                </span>
              </div>
              <div className="flex gap-6 text-sm text-gray-600 mb-4">
                <span>{consultation.time}</span>
              </div>
              <button className="px-4 py-2 bg-gray-900 text-white rounded font-medium hover:bg-gray-800 transition-colors text-sm">
                Cancel
              </button>
            </div>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
