import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <div className="text-center px-4">
        <div className="text-6xl font-bold text-orange-700 mb-4">404</div>
        <h1 className="text-3xl font-bold text-white mb-2">Page Not Found</h1>
        <p className="text-lg text-zinc-400 mb-8">
          The page you're looking for doesn't exist.
        </p>
        <Button
          onClick={() => navigate("/")}
          className="bg-orange-700 hover:bg-orange-800 text-white"
        >
          <Home className="w-4 h-4 mr-2" />
          Return to Dashboard
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
