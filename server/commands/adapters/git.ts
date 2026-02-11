import { CommandAdapter } from "./types";

export const gitAdapter: CommandAdapter = {
  family: "git",
  build(tokens) {
    return {
      executable: "git",
      args: tokens.slice(1),
    };
  },
};
