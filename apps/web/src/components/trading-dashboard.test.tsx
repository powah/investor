import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { TradingDashboard } from "@/modules/trading-dashboard";
import { InMemoryDashboardRemote } from "@/test/dashboard-remote";

describe("TradingDashboard", () => {
  test("preserves an unfinished Planner draft while the operator visits another workspace", async () => {
    const user = userEvent.setup();
    render(<TradingDashboard remote={new InMemoryDashboardRemote()} />);

    expect(await screen.findByRole("heading", { name: "Scanner" })).toBeVisible();
    expect((await screen.findAllByRole("button", { name: "ALFA" })).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("tab", { name: /Trade planner/ }));
    expect(screen.getByRole("heading", { name: "Trade planner" })).toBeVisible();
    expect(screen.getByLabelText("Ticker")).toHaveValue("ALFA");

    await user.type(screen.getByLabelText("Stop"), "9.25");
    await user.type(screen.getByLabelText("Target"), "11.50");

    await user.click(screen.getByRole("tab", { name: /Journal/ }));
    expect(screen.getByRole("heading", { name: "Trade journal" })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /Trade planner/ }));

    expect(screen.getByLabelText("Stop")).toHaveValue(9.25);
    expect(screen.getByLabelText("Target")).toHaveValue(11.5);
  });

  test("flows the selected Candidate into the Planner", async () => {
    const user = userEvent.setup();
    render(<TradingDashboard remote={new InMemoryDashboardRemote()} />);

    const betaButtons = await screen.findAllByRole("button", { name: "BETA" });
    await user.click(betaButtons[0]);
    await user.click(screen.getByRole("button", { name: /Build plan/ }));

    expect(screen.getByRole("heading", { name: "Trade planner" })).toBeVisible();
    expect(screen.getByLabelText("Ticker")).toHaveValue("BETA");
    expect(screen.getByLabelText(/^Entry/)).toHaveValue(8.5);
    expect(screen.getByRole("status")).toHaveTextContent(
      "BETA loaded into the risk planner. Define the stop before sizing.",
    );
  });

  test("preserves an unfinished Risk Rules draft across workspace navigation", async () => {
    const user = userEvent.setup();
    render(<TradingDashboard remote={new InMemoryDashboardRemote()} />);

    await screen.findAllByRole("button", { name: "ALFA" });
    await user.click(screen.getByRole("tab", { name: /Risk rules/ }));
    const accountSize = screen.getByLabelText("Account size");
    await user.clear(accountSize);
    await user.type(accountSize, "30000");

    await user.click(screen.getByRole("tab", { name: /Scanner/ }));
    await user.click(screen.getByRole("tab", { name: /Risk rules/ }));

    expect(screen.getByLabelText("Account size")).toHaveValue(30000);
  });

  test("starts a Journal draft from a saved Trade Plan", async () => {
    const user = userEvent.setup();
    render(<TradingDashboard remote={new InMemoryDashboardRemote()} />);

    await screen.findAllByRole("button", { name: "ALFA" });
    await user.click(screen.getByRole("tab", { name: /Trade planner/ }));
    await user.click(screen.getByRole("button", { name: /Journal/ }));

    expect(screen.getByRole("heading", { name: "Trade journal" })).toBeVisible();
    expect(screen.getByLabelText("Ticker")).toHaveValue("ALFA");
    expect(screen.getByLabelText("Shares")).toHaveValue(500);
    expect(screen.getByRole("status")).toHaveTextContent(
      "ALFA plan loaded into the journal. Add the actual exit and review execution.",
    );
  });

  test("does not begin Operations remote work until the operator opens Operations", async () => {
    const user = userEvent.setup();
    const remote = new InMemoryDashboardRemote();
    render(<TradingDashboard remote={remote} />);

    await screen.findAllByRole("button", { name: "ALFA" });
    expect(remote.requestedOperations.some((operation) => operation.startsWith("operations."))).toBe(false);

    await user.click(screen.getByRole("tab", { name: /Operations/ }));
    expect(screen.getByRole("heading", { name: "Operations" })).toBeVisible();
    await waitFor(() => {
      expect(remote.requestedOperations).toEqual(
        expect.arrayContaining([
          "operations.getIntegrationsStatus",
          "operations.listMarketSnapshots",
          "operations.listExternalEvents",
          "operations.getAutomationSettings",
          "operations.listExecutions",
          "operations.getBrokerStream",
        ]),
      );
    });
    expect(await screen.findByText("Setup status")).toBeVisible();
  });
});
