import { Link } from "react-router-dom";
import { ArrowRight, MessageSquare, Calendar, BarChart3, Shield } from "lucide-react";

export default function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="font-bold text-slate-900">CLIRDEC</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-slate-600 hover:text-slate-900 text-sm font-medium">Features</a>
            <a href="#benefits" className="text-slate-600 hover:text-slate-900 text-sm font-medium">Benefits</a>
            <Link 
              to="/login" 
              className="px-6 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="mb-6 inline-block">
            <span className="px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium">
              Powered by AI • Smart Scheduling
            </span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold text-slate-900 mb-6 leading-tight">
            Connect with Faculty Experts
          </h1>
          <p className="text-xl text-slate-600 mb-8 max-w-2xl mx-auto">
            CLIRDEC Consultation Portal: Intelligent academic consultation scheduling powered by AI matching. Get expert guidance exactly when you need it.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              to="/login" 
              className="px-8 py-4 bg-primary text-white rounded-lg font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              Get Started <ArrowRight size={20} />
            </Link>
            <a 
              href="#features"
              className="px-8 py-4 bg-white border-2 border-slate-200 text-slate-900 rounded-lg font-semibold hover:border-slate-300 transition-colors"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Hero Image */}
      <section className="px-4 sm:px-6 lg:px-8 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl bg-gradient-to-b from-primary/5 to-slate-100 border border-slate-200 p-8 md:p-12 h-96 flex items-center justify-center">
            <div className="text-center text-slate-400">
              <MessageSquare size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-sm">Smart Consultation Interface Coming Soon</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">Core Features</h2>
            <p className="text-lg text-slate-600">Everything you need for seamless academic consultations</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-8 rounded-xl border border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <MessageSquare className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-3">AI Chatbot Matching</h3>
              <p className="text-slate-600">
                Describe your academic needs in natural language. Our AI system instantly matches you with the right faculty expert.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8 rounded-xl border border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Calendar className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-3">Smart Scheduling</h3>
              <p className="text-slate-600">
                Faculty manage their availability in real-time. Students book slots instantly with automated conflict prevention.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-xl border border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <BarChart3 className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-3">Analytics Dashboard</h3>
              <p className="text-slate-600">
                Administrators access comprehensive insights: response times, satisfaction scores, and performance metrics.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-8 rounded-xl border border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Shield className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-3">Institution Email Auth</h3>
              <p className="text-slate-600">
                Secure, role-based authentication using CLSU institutional emails (@clsu.edu.ph).
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-8 rounded-xl border border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <MessageSquare className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-3">Anonymous Feedback</h3>
              <p className="text-slate-600">
                Students provide honest feedback after consultations. Complete anonymity ensures unbiased evaluations.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-8 rounded-xl border border-slate-200 hover:border-primary/30 hover:shadow-lg transition-all">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <ArrowRight className="text-primary" size={24} />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-3">Real-time Notifications</h3>
              <p className="text-slate-600">
                Instant push notifications and emails keep students and faculty updated on schedule changes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl font-bold text-slate-900 mb-6">Why CLIRDEC?</h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Eliminate Walk-in Chaos</h3>
                    <p className="text-slate-600 text-sm">Replace manual, unreliable consultations with automated scheduling</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Intelligent Pairing</h3>
                    <p className="text-slate-600 text-sm">AI ensures students meet the right faculty experts for their needs</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Better Insights</h3>
                    <p className="text-slate-600 text-sm">Comprehensive data-driven analytics for continuous improvement</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Mobile-First Design</h3>
                    <p className="text-slate-600 text-sm">Native-like experience on any device</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="rounded-2xl bg-gradient-to-b from-primary/5 to-slate-100 border border-slate-200 p-12 h-80 flex items-center justify-center">
                <div className="text-center text-slate-400">
                  <BarChart3 size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm">Analytics Dashboard Preview</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-100">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 text-center mb-12">Test the Platform</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center mb-4">
                <div className="w-6 h-6 rounded-full bg-blue-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Student Dashboard</h3>
              <p className="text-slate-600 text-sm mb-4">Experience the AI chatbot interface and faculty matching system</p>
              <Link
                to="/student"
                className="inline-block px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors text-sm"
              >
                View Demo →
              </Link>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center mb-4">
                <div className="w-6 h-6 rounded-full bg-purple-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Faculty Dashboard</h3>
              <p className="text-slate-600 text-sm mb-4">Manage your profile, expertise tags, and weekly schedule</p>
              <Link
                to="/faculty"
                className="inline-block px-4 py-2 bg-purple-500 text-white rounded-lg font-semibold hover:bg-purple-600 transition-colors text-sm"
              >
                View Demo →
              </Link>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center mb-4">
                <div className="w-6 h-6 rounded-full bg-emerald-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Admin Dashboard</h3>
              <p className="text-slate-600 text-sm mb-4">View analytics, faculty rankings, and feedback logs</p>
              <Link
                to="/admin"
                className="inline-block px-4 py-2 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 transition-colors text-sm"
              >
                View Demo →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">Ready to Transform Your Consultations?</h2>
          <p className="text-lg text-primary/90 mb-8">Join CLIRDEC and experience intelligent, efficient academic support.</p>
          <Link
            to="/login"
            className="inline-block px-8 py-4 bg-white text-primary rounded-lg font-semibold hover:bg-slate-50 transition-colors"
          >
            Get Started Now
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto text-center">
          <p className="mb-2">CLIRDEC Consultation Portal</p>
          <p className="text-sm">Central Luzon State University • ICT Research and Development Training Center</p>
          <p className="text-sm mt-4">Science City of Muñoz, Nueva Ecija, Philippines</p>
        </div>
      </footer>
    </div>
  );
}
