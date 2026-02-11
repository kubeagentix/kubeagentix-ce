import { CommandAdapter } from "./types";

export const shellAdapter: CommandAdapter = {
  family: "sh",
  build(tokens) {
    const executable = tokens[0] === "bash" ? "bash" : "sh";
    return {
      executable,
      args: tokens.slice(1),
    };
  },
};
