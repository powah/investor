import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { OperationsWorkspace } from "@/modules/trading-dashboard/operations-workspace";
import { InMemoryDashboardRemote } from "@/test/dashboard-remote";

describe("OperationsWorkspace", () => {
  test("keeps successful Operations data visible when one remote request fails", async () => {
    const dashboardRemote = new InMemoryDashboardRemote();
    const remote = {
      ...dashboardRemote.operations,
      listExternalEvents: () => Promise.reject(new Error("News service offline")),
    };

    render(
      <OperationsWorkspace
        remote={remote}
        plans={[]}
        onWorkspaceRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(await screen.findByText("Setup status")).toBeVisible();
    expect(screen.getByText(/external events: News service offline/)).toBeVisible();
    expect(screen.getByText("Kill switch")).toBeVisible();
  });
});
