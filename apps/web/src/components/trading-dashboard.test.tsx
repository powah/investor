import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { TradingDashboard } from "@/components/trading-dashboard";
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

  test("does not begin Operations remote work until the operator opens Operations", async () => {
    const user = userEvent.setup();
    const remote = new InMemoryDashboardRemote();
    render(<TradingDashboard remote={remote} />);

    await screen.findAllByRole("button", { name: "ALFA" });
    expect(remote.requestedPaths.some((path) => path.startsWith("/integrations/"))).toBe(false);

    await user.click(screen.getByRole("tab", { name: /Operations/ }));
    expect(screen.getByRole("heading", { name: "Operations" })).toBeVisible();
    await waitFor(() => {
      expect(remote.requestedPaths.some((path) => path.startsWith("/integrations/"))).toBe(true);
    });
    expect(await screen.findByText("Setup status")).toBeVisible();
  });
});
