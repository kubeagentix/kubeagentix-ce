import { Button } from "@/components/ui/button";

function getDefaultQuestions(namespace: string): string[] {
  return [
    "Which namespaces can I access?",
    `Show me pods in the ${namespace} namespace`,
    `Show warning events in the ${namespace} namespace`,
    "Show non-running pods across all namespaces",
  ];
}

interface SuggestedQuestionsProps {
  questions?: string[];
  namespace?: string;
  onSelect: (question: string) => void;
}

/**
 * Suggested questions component
 * Displays pre-written questions users can click to ask the agent
 */
export function SuggestedQuestions({
  questions,
  namespace = "default",
  onSelect,
}: SuggestedQuestionsProps) {
  const starterQuestions = questions ?? getDefaultQuestions(namespace);

  return (
    <div className="w-full max-w-2xl space-y-3">
      <h3 className="text-sm font-medium text-zinc-400">Suggested Questions</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {starterQuestions.map((question, index) => (
          <Button
            key={index}
            variant="ghost"
            size="sm"
            onClick={() => onSelect(question)}
            className="justify-start h-auto py-2 px-3 text-xs sm:text-sm text-left bg-zinc-300/90 text-zinc-950 border border-zinc-300 hover:bg-zinc-200 hover:text-zinc-950"
          >
            {question}
          </Button>
        ))}
      </div>
    </div>
  );
}
