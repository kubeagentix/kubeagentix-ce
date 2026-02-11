import { CommandFamily } from "@shared/terminal";

export interface SpawnSpec {
  executable: string;
  args: string[];
}

export interface AdapterBuildOptions {
  clusterContext?: string;
}

export interface CommandAdapter {
  readonly family: CommandFamily;
  build(tokens: string[], options?: AdapterBuildOptions): SpawnSpec;
}
