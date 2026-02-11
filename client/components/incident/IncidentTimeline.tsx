import { CheckCircle, Clock, AlertCircle } from "lucide-react";

interface TimelineEvent {
  time: string;
  title: string;
  description?: string;
  status: "complete" | "pending" | "error";
}

interface IncidentTimelineProps {
  events: TimelineEvent[];
}

export function IncidentTimeline({ events }: IncidentTimelineProps) {
  const statusIcon = {
    complete: <CheckCircle className="w-5 h-5 text-green-500" />,
    pending: <Clock className="w-5 h-5 text-yellow-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
  };

  return (
    <div className="space-y-4">
      {events.map((event, idx) => (
        <div key={idx} className="flex gap-4">
          <div className="flex flex-col items-center">
            {statusIcon[event.status]}
            {idx < events.length - 1 && (
              <div className="w-0.5 h-12 bg-zinc-700 my-2" />
            )}
          </div>
          <div className="pt-1">
            <div className="text-sm font-mono text-zinc-400">{event.time}</div>
            <div className="font-semibold text-white">{event.title}</div>
            {event.description && (
              <div className="text-sm text-zinc-400 mt-1">
                {event.description}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
