import { CommandAdapter } from "./types";

export const kubectlAdapter: CommandAdapter = {
  family: "kubectl",
  build(tokens, options) {
    const args = tokens.slice(1);
    const hasExplicitContext = args.some(
      (arg) => arg === "--context" || arg.startsWith("--context="),
    );
    const isConfigCommand = tokens[1] === "config";

    if (options?.clusterContext && !hasExplicitContext && !isConfigCommand) {
      return {
        executable: "kubectl",
        args: ["--context", options.clusterContext, ...args],
      };
    }

    return {
      executable: "kubectl",
      args,
    };
  },
};
