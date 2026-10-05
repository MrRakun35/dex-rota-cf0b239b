import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradingBot } from "@/services/bots";
import { BotStatistics } from "./BotStatistics";

const now = new Date("2026-10-05T12:00:00Z");
const bot = (
  kind: TradingBot["kind"] = "DCA",
  status: TradingBot["status"] = "active",
) =>
  ({
    kind,
    status,
    statistics: {
      gross_realized_pnl: 12.5,
      executed_orders: 105,
      filled_orders: 100,
      closing_orders: 50,
      runtime_seconds: 3600,
      as_of: now.toISOString(),
      started_at: now.toISOString(),
      profit_since: now.toISOString(),
      runtime_since: now.toISOString(),
      profit_history_complete: true,
      runtime_history_complete: true,
    },
  }) as TradingBot;

describe("BotStatistics", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
  const render = (item: TradingBot, expanded = false) =>
    act(() => root.render(<BotStatistics bot={item} expanded={expanded} />));
  it.each(["DCA", "MARKET_MAKER"] as const)(
    "shows complete totals for %s",
    (kind) => {
      render(bot(kind));
      expect(host.textContent).toContain("+12.5 USDC");
      expect(host.textContent).toContain("Executed orders105");

      expect(host.textContent).toContain("1h 0m 0s");

      act(() => vi.advanceTimersByTime(2000));
      expect(host.textContent).toContain("1h 0m 2s");
    },
  );
  it.each(["paused", "stopped"] as const)(
    "freezes runtime for %s bots",
    (status) => {
      render(bot("DCA", status));
      act(() => vi.advanceTimersByTime(60000));
      expect(host.textContent).toContain("1h 0m 0s");
    },
  );
  it("excludes TWAP", () => {
    render(bot("TWAP"));
    expect(host.textContent).toBe("");
  });
  it("shows losses and distinguishes incomplete legacy history", () => {
    const item = bot("MARKET_MAKER", "stopped");
    item.statistics!.gross_realized_pnl = -7;
    item.statistics!.profit_history_complete = false;
    item.statistics!.runtime_history_complete = false;
    render(item);
    expect(host.querySelector(".is-loss")?.textContent).toBe("-7 USDC");
    render(item, true);
    expect(host.textContent).toContain("earlier daily totals are unavailable");
    expect(host.textContent).toContain("earlier pause history is unavailable");
  });
  it("does not invent missing profit as zero", () => {
    const item = bot("MARKET_MAKER", "stopped");
    item.statistics!.gross_realized_pnl = null;
    item.statistics!.profit_history_complete = false;
    render(item, true);
    expect(host.textContent).toContain("Historical grid profit is unavailable");
    expect(host.textContent).not.toContain("0 USDC");
  });
  it("keeps explanations and closing counts in expanded details", () => {
    render(bot());
    expect(host.textContent).not.toContain("Closing orders");
    expect(host.textContent).not.toContain("excludes fees");
    render(bot(), true);
    expect(host.textContent).toContain("Closing orders 50");
    expect(host.textContent).toContain("excludes fees, funding");
  });
  it("shows a compact pending state without empty metric boxes", () => {
    const item = bot();
    delete item.statistics;
    render(item);
    expect(host.textContent).toBe("Performance pending");
    expect(host.querySelector(".rota-bots__statistics-grid")).toBeNull();
  });
});
