import { describe, expect, it } from "vitest";
import { kubectlAdapter } from "../adapters/kubectl";

describe("kubectl adapter", () => {
  it("injects cluster context when none is explicitly provided", () => {
    const spec = kubectlAdapter.build(["kubectl", "get", "pods"], {
      clusterContext: "prod-us-west",
    });

    expect(spec.executable).toBe("kubectl");
    expect(spec.args).toEqual(["--context", "prod-us-west", "get", "pods"]);
  });

  it("preserves explicit --context flags", () => {
    const spec = kubectlAdapter.build(
      ["kubectl", "get", "pods", "--context", "custom-cluster"],
      {
        clusterContext: "prod-us-west",
      },
    );

    expect(spec.args).toEqual(["get", "pods", "--context", "custom-cluster"]);
  });

  it("does not inject context for kubectl config commands", () => {
    const spec = kubectlAdapter.build(
      ["kubectl", "config", "get-contexts", "-o", "name"],
      {
        clusterContext: "prod-us-west",
      },
    );

    expect(spec.args).toEqual(["config", "get-contexts", "-o", "name"]);
  });
});
