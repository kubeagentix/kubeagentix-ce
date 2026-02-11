import { describe, expect, it } from "vitest";
import { parseAgenticRcaText } from "../rca";

describe("parseAgenticRcaText", () => {
  it("parses strict JSON output", () => {
    const raw = `{"probableRootCause":"Image pull is failing due to unauthorized registry access.","hypotheses":[{"id":"image-pull-auth","title":"Registry credentials invalid","confidence":92,"summary":"ImagePullBackOff with unauthorized event indicates bad image pull secret."}],"analysisNote":"Correlated pod waiting reason with warning events."}`;

    const parsed = parseAgenticRcaText(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.probableRootCause).toContain("Image pull");
    expect(parsed?.hypotheses[0]?.id).toBe("image-pull-auth");
  });

  it("parses markdown/prose fallback output", () => {
    const raw = `
### Quick diagnosis
Probable root cause: Liveness probe configuration mismatch is causing repeated restarts.

Top hypotheses:
1. Liveness probe path/port is incorrect (89%)
2. Probe timeout is too short for startup behavior (74%)
3. Dependency call blocks readiness and fails liveness (66%)

Analysis note: Events and pod state are consistent with probe-triggered restarts.
`;

    const parsed = parseAgenticRcaText(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.probableRootCause.toLowerCase()).toContain("liveness probe");
    expect(parsed?.hypotheses.length).toBeGreaterThan(0);
    expect(parsed?.analysisNote).toContain("probe-triggered");
  });

  it("rejects malformed JSON fragments masquerading as prose", () => {
    const raw = `{"probableRootCause":"The pod is healthy","hyp`;
    const parsed = parseAgenticRcaText(raw);
    expect(parsed).toBeNull();
  });
});
