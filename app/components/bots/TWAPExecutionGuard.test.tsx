import { act, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  TWAPExecutionGuard,
  defaultTWAPExecutionGuard,
  twapExecutionGuardConfig,
  twapExecutionGuardValidation,
} from "./TWAPExecutionGuard";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe("TWAP execution protection", () => {
  it("keeps old TWAP requests unchanged until protection is enabled", () => {
    const settings = { ...defaultTWAPExecutionGuard, maxDeviationPercent: "" };
    expect(twapExecutionGuardConfig(settings)).toBeUndefined();
    expect(twapExecutionGuardValidation(settings)).toBe("");
    expect(
      twapExecutionGuardValidation({ ...settings, enabled: true }),
    ).toContain("deviation");
  });
  it("sends percentage inputs as basis points without losing the liquidity ratio", () => {
    expect(
      twapExecutionGuardConfig({
        ...defaultTWAPExecutionGuard,
        enabled: true,
        maxDeviationPercent: "0.75",
        minDepthRatio: "2.5",
      }),
    ).toEqual({
      enabled: true,
      max_spread_bps: 20,
      max_price_impact_bps: 30,
      min_depth_ratio: 2.5,
      max_deviation_bps: 75,
    });
    for (const value of ["", "0", "0.005", "11", "Infinity"]) {
      expect(
        twapExecutionGuardValidation({
          ...defaultTWAPExecutionGuard,
          enabled: true,
          maxDeviationPercent: value,
        }),
      ).not.toBe("");
    }
    expect(
      twapExecutionGuardValidation({
        ...defaultTWAPExecutionGuard,
        enabled: true,
        minDepthRatio: "0.5",
      }),
    ).toContain("coverage");
  });
  it("reveals optional settings and explains waiting without submitting a bot", () => {
    function Harness() {
      const [settings, setSettings] = useState(defaultTWAPExecutionGuard);
      return <TWAPExecutionGuard settings={settings} onChange={setSettings} />;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Harness />));
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Liquidity & price protection"]',
    )!;
    expect(toggle.type).toBe("button");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("TWAP add-on");
    expect(container.textContent).toContain("Binance and Coinbase");
    expect(container.textContent).toContain("slice waits and retries");
    expect(container.textContent).not.toContain("Maximum spread");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Maximum spread (%)");
    expect(container.textContent).toContain("Binance and Coinbase");
    expect(container.textContent).toContain("slice waits and retries");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).not.toContain("Maximum spread");
  });
});
