import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { IncidentCase } from "@shared/incident";
import Incident from "../Incident";

const listIncidentsMock = vi.fn();
const getIncidentMock = vi.fn();
const createIncidentMock = vi.fn();
const updateIncidentMock = vi.fn();
const createActionMock = vi.fn();
const approveActionMock = vi.fn();
const executeActionMock = vi.fn();
const investigateIncidentMock = vi.fn();

vi.mock("@/hooks/useIncidents", () => ({
  useIncidents: () => ({
    loading: false,
    error: null,
    listIncidents: listIncidentsMock,
    getIncident: getIncidentMock,
    createIncident: createIncidentMock,
    updateIncident: updateIncidentMock,
    createAction: createActionMock,
    approveAction: approveActionMock,
    executeAction: executeActionMock,
    investigateIncident: investigateIncidentMock,
  }),
}));

function buildIncident(overrides: Partial<IncidentCase> = {}): IncidentCase {
  return {
    id: "inc-1",
    title: "Checkout API outage",
    description: "Checkout API elevated 5xx",
    status: "investigating",
    severity: "high",
    owner: "oncall",
    services: ["checkout"],
    entities: [],
    graphEdges: [],
    source: "manual",
    externalRefs: [],
    correlations: [],
    diagnoses: [],
    actions: [],
    timeline: [
      {
        id: "evt-old",
        timestamp: 1000,
        type: "intake",
        actor: "system",
        source: "manual",
        message: "older event",
      },
      {
        id: "evt-new",
        timestamp: 2000,
        type: "analysis",
        actor: "operator",
        source: "api",
        message: "newer event",
      },
    ],
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function primeMocks(incident: IncidentCase): void {
  listIncidentsMock.mockResolvedValue({
    items: [
      {
        id: incident.id,
        title: incident.title,
        status: incident.status,
        severity: incident.severity,
        owner: incident.owner,
        source: incident.source,
        services: incident.services,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      },
    ],
    total: 1,
  });
  getIncidentMock.mockResolvedValue(incident);
  createIncidentMock.mockResolvedValue(incident);
  updateIncidentMock.mockResolvedValue(incident);
  createActionMock.mockResolvedValue(incident);
  approveActionMock.mockResolvedValue(incident);
  executeActionMock.mockResolvedValue(incident);
  investigateIncidentMock.mockResolvedValue({
    incident,
    summary: {
      entityCount: incident.entities.length,
      edgeCount: incident.graphEdges.length,
      correlationCount: incident.correlations.length,
      warningCount: 0,
    },
    warnings: [],
  });
}

describe("Incident page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders incident detail and timeline in descending timestamp order", async () => {
    const incident = buildIncident();
    primeMocks(incident);

    const { container } = render(
      <MemoryRouter>
        <Incident />
      </MemoryRouter>,
    );

    await screen.findByText("newer event");

    const timelineRows = Array.from(
      container.querySelectorAll("div.text-sm.font-medium.text-zinc-200"),
    )
      .map((element) => element.textContent?.trim() || "")
      .filter((text) => text.includes("event"));

    expect(timelineRows[0]).toBe("newer event");
    expect(timelineRows[1]).toBe("older event");
  });

  it("applies inbox status filter through incident list API", async () => {
    const incident = buildIncident();
    primeMocks(incident);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Incident />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(listIncidentsMock).toHaveBeenCalled();
    });
    await user.selectOptions(screen.getByDisplayValue("All statuses"), "triage");

    await waitFor(() => {
      expect(listIncidentsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "triage" }),
      );
    });
  });

  it("enforces approve-before-execute in the action panel", async () => {
    const incident = buildIncident({
      actions: [
        {
          id: "act-1",
          title: "Restart checkout deployment",
          type: "command",
          risk: "high",
          requiresApproval: true,
          approvalState: "pending",
          proposedBy: "operator",
          command: "kubectl rollout restart deploy/checkout -n prod",
          createdAt: 1500,
          updatedAt: 1500,
        },
      ],
    });
    primeMocks(incident);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Incident />
      </MemoryRouter>,
    );

    await screen.findByText("Restart checkout deployment");
    expect(screen.getByRole("button", { name: "Execute (Dry Run)" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveActionMock).toHaveBeenCalledWith(
        "inc-1",
        "act-1",
        expect.objectContaining({
          actor: "operator",
          approved: true,
        }),
      );
    });
  });
});
