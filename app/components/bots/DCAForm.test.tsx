import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  DCAForm,
  defaultDCASettings,
  dcaConfig,
  dcaPlan,
  dcaValidation as validate,
  dcaMinimumMargins,
} from "./DCAForm";

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

const rules = { min_notional: 10, base_tick: 0.001, base_min: 0.001 };
const dcaValidation = (settings: typeof defaultDCASettings, price: number) =>
  validate(settings, price, rules);

describe("DCA configuration", () => {
  it("budgets the base plus eight growing orders", () => {
    expect(dcaPlan(defaultDCASettings).budget).toBeCloseTo(248.717762);
    expect(dcaPlan(defaultDCASettings).deviation).toBe(4);
    expect(dcaValidation(defaultDCASettings, 100)).toBe("");
  });
  it("excludes disabled conditions and rejects missing enabled prices", () => {
    const settings = {
      ...defaultDCASettings,
      start_price: "95",
      stop_price: "110",
      stop_loss_percent: "5",
    };
    expect(dcaConfig(settings).start_price).toBe(0);
    expect(dcaConfig(settings).stop_price).toBe(0);
    expect(dcaConfig(settings).stop_loss_percent).toBe(0);
    expect(dcaConfig({ ...settings, start_enabled: true }).start_price).toBe(
      95,
    );
    expect(
      dcaValidation({ ...settings, start_enabled: true, start_price: "" }, 100),
    ).toContain("start trigger");
  });
  it("rejects ladders that exhaust the price range and insufficient notional", () => {
    expect(
      dcaValidation(
        { ...defaultDCASettings, price_deviation_multiplier: "2" },
        100,
      ),
    ).toContain("cumulative");
    expect(
      dcaValidation({ ...defaultDCASettings, base_order_margin: "5" }, 100),
    ).toContain("notional");
    expect(
      dcaValidation(
        { ...defaultDCASettings, base_order_margin: "5", leverage: "3" },
        100,
      ),
    ).toBe("");
  });
  it("uses exchange minimums, leverage, start price and quantity rounding", () => {
    const market = { min_notional: 25, base_tick: 0.03, base_min: 0.3 };
    const settings = {
      ...defaultDCASettings,
      leverage: "2",
      start_enabled: true,
      start_price: "100",
    };
    const minimums = dcaMinimumMargins(settings, 200, market)!;
    expect(minimums.base).toBe(15);
    expect(
      validate({ ...settings, base_order_margin: "14" }, 200, market),
    ).toContain("Base order");
    expect(
      validate({ ...settings, dca_order_margin: "1" }, 200, market),
    ).toContain("DCA order");
    expect(
      validate(
        {
          ...settings,
          base_order_margin: String(minimums.base),
          dca_order_margin: String(minimums.dca),
        },
        200,
        market,
      ),
    ).toBe("");
    expect(validate(settings, 200)).toContain("Loading");
    const short = {
      ...settings,
      direction: "SHORT",
      order_size_multiplier: "1",
    };
    expect(dcaMinimumMargins(short, 200, market)!.dca).toBeGreaterThan(15);
  });
  it("renders quote-specific fields and exposes optional controls", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let settings = { ...defaultDCASettings };
    const render = () =>
      root?.render(
        <DCAForm
          settings={settings}
          quoteAsset="USDC"
          onChange={(next) => {
            settings = next;
            render();
          }}
        />,
      );
    act(render);
    expect(container.textContent).toContain("Base Order Margin (USDC)");
    expect(container.textContent).not.toContain("Leverage (×)");
    const short = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Short",
    )!;
    act(() => short.click());
    expect(settings.direction).toBe("SHORT");
    expect(container.textContent).toContain("Price rise steps (%)");
    const start = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    act(() => start.click());
    expect(settings.start_enabled).toBe(true);
    expect(container.textContent).toContain(
      "Each round places a sell limit order",
    );
    const reset = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Reset settings"),
    )!;
    act(() => reset.click());
    expect(settings).toEqual(defaultDCASettings);
  });
});
