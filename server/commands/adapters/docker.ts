import { CommandAdapter } from "./types";

export const dockerAdapter: CommandAdapter = {
  family: "docker",
  build(tokens) {
    return {
      executable: "docker",
      args: tokens.slice(1),
    };
  },
};
