import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
          <p className="text-2xl font-bold text-slate-900 mb-2">Page Not Found</p>
          <p className="text-slate-600">The page you're looking for doesn't exist or has been moved.</p>
        </div>

        <div className="space-y-3">
          <Link
            to="/"
            className="w-full px-6 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            Back to Home <ArrowRight size={20} />
          </Link>
          <Link
            to="/login"
            className="w-full px-6 py-3 bg-slate-100 text-slate-900 rounded-lg font-semibold hover:bg-slate-200 transition-colors"
          >
            Sign In
          </Link>
        </div>

        <p className="text-xs text-slate-500 mt-8">
          Error Code: 404 | Path: {location.pathname}
        </p>
      </div>
    </div>
  );
};

export default NotFound;
