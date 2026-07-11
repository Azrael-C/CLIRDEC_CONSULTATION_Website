import { useState } from "react";
import { Link } from "react-router-dom";
import { User, Users, BarChart3, ArrowLeft, Eye, EyeOff } from "lucide-react";

type AuthMode = "login" | "register";
type UserRole = "student" | "faculty" | "admin" | null;

export default function Auth() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [role, setRole] = useState<UserRole>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    department: "",
  });

  const roles = [
    {
      id: "student",
      name: "Student",
      icon: User,
      description: "Find faculty experts and book consultations",
      color: "from-green-600 to-green-700",
    },
    {
      id: "faculty",
      name: "Faculty Member",
      icon: Users,
      description: "Manage availability and expertise tags",
      color: "from-green-600 to-green-700",
    },
    {
      id: "admin",
      name: "Administrator",
      icon: BarChart3,
      description: "Access analytics and oversee operations",
      color: "from-green-600 to-green-700",
    },
  ];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Auth submission:", { mode, role, ...formData });
    // TODO: Implement actual authentication
  };

  if (!role) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white to-green-50 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-12">
            <Link to="/" className="inline-flex items-center gap-2 text-gray-600 hover:text-green-900 mb-8">
              <ArrowLeft size={20} />
              <span className="text-sm font-medium">Back to Home</span>
            </Link>
            <h1 className="text-4xl font-bold text-green-900 mb-2">Welcome to Consult</h1>
            <p className="text-lg text-gray-700">Select your role to continue</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {roles.map((r) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  onClick={() => setRole(r.id as UserRole)}
                  className="group p-8 rounded border-2 border-green-200 hover:border-green-500 hover:shadow-lg transition-all text-left bg-white"
                >
                  <div className={`w-16 h-16 rounded bg-gradient-to-br ${r.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <Icon size={32} className="text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-green-900 mb-2">{r.name}</h3>
                  <p className="text-gray-700">{r.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const selectedRole = roles.find(r => r.id === role);
  const Icon = selectedRole?.icon || User;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-green-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => setRole(null)}
            className="flex items-center gap-2 text-gray-600 hover:text-green-900 mb-6"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Change Role</span>
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-green-700 rounded flex items-center justify-center">
              <Icon size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-green-900">{mode === "login" ? "Sign In" : "Create Account"}</h1>
              <p className="text-sm text-gray-700">{selectedRole?.name}</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-green-900 mb-2">Full Name</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                placeholder="Enter your full name"
                className="w-full px-4 py-3 rounded border border-green-200 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-100 transition-all"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-green-900 mb-2">CLSU Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="yourname@clsu.edu.ph"
              className="w-full px-4 py-3 rounded border border-green-200 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-100 transition-all"
              required
            />
            <p className="text-xs text-gray-600 mt-1">Use your institutional email address</p>
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-green-900 mb-2">Department / College</label>
              <select
                name="department"
                value={formData.department}
                onChange={handleInputChange}
                className="w-full px-4 py-3 rounded border border-green-200 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-100 transition-all bg-white"
                required
              >
                <option value="">Select your department</option>
                <option value="cics">College of Information and Communications Studies</option>
                <option value="coe">College of Engineering</option>
                <option value="cas">College of Arts and Sciences</option>
                <option value="cab">College of Agriculture and Biotechnology</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-green-900 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Enter your password"
                className="w-full px-4 py-3 rounded border border-green-200 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-100 transition-all"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-green-900"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-green-900 mb-2">Confirm Password</label>
              <input
                type={showPassword ? "text" : "password"}
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                placeholder="Confirm your password"
                className="w-full px-4 py-3 rounded border border-green-200 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-100 transition-all"
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="w-full mt-6 px-4 py-3 bg-green-700 text-white rounded font-semibold hover:bg-green-800 transition-colors"
          >
            {mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        {/* Toggle Mode */}
        <div className="mt-6 text-center">
          <p className="text-gray-700 text-sm">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setFormData({ fullName: "", email: "", password: "", confirmPassword: "", department: "" });
              }}
              className="text-green-700 font-semibold hover:underline"
            >
              {mode === "login" ? "Sign Up" : "Sign In"}
            </button>
          </p>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-green-200 text-center">
          <p className="text-xs text-gray-600">
            By continuing, you agree to Consult's Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}
