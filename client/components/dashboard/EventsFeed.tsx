import { AlertCircle, Info, CheckCircle, Zap } from "lucide-react";

interface Event {
  id: string;
  type: "warning" | "info" | "success" | "critical";
  title: string;
  description: string;
  timestamp: string;
}

interface EventsFeedProps {
  events: Event[];
}

const EventIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "warning":
      return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    case "critical":
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "success":
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case "info":
      return <Info className="w-4 h-4 text-sky-500" />;
    default:
      return null;
  }
};

export const EventsFeed = ({ events }: EventsFeedProps) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Recent Events</h3>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {events.length === 0 ? (
          <div className="text-center text-zinc-500 py-8">No recent events</div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 p-3 bg-zinc-800/50 border border-zinc-700 rounded"
            >
              <div className="mt-1 flex-shrink-0">
                <EventIcon type={event.type} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">
                  {event.title}
                </div>
                <div className="text-xs text-zinc-400 mt-1">
                  {event.description}
                </div>
                <div className="text-xs text-zinc-500 mt-2">
                  {event.timestamp}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
