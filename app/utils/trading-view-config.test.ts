import { afterEach, describe, expect, it } from "vitest";
import { createTradingViewConfig } from "./trading-view-config";

afterEach(() => {
  delete window.__RUNTIME_CONFIG__;
});

describe("createTradingViewConfig", () => {
  it("omits the legacy color config when SDK themes are active", () => {
    window.__RUNTIME_CONFIG__ = {
      VITE_TRADING_VIEW_COLOR_CONFIG: JSON.stringify({ upColor: "#ff0000" }),
    };

    expect(createTradingViewConfig("theme-config").colorConfig).toBeUndefined();
  });

  it("keeps the legacy color config for legacy fallback", () => {
    window.__RUNTIME_CONFIG__ = {
      VITE_TRADING_VIEW_COLOR_CONFIG: JSON.stringify({
        upColor: "#ff0000",
        font: "Manrope",
      }),
    };

    expect(createTradingViewConfig("legacy").colorConfig).toEqual({
      upColor: "#ff0000",
      font: "Manrope",
    });
  });

  it("disables default volume indicator creation", () => {
    const config = createTradingViewConfig("theme-config");
    expect(config.disabled_features).toContain(
      "create_volume_indicator_by_default",
    );
    expect(config.disabled_features).toContain(
      "create_volume_indicator_by_default_once",
    );
  });

  it("configures studies overrides for RSI", () => {
    const config = createTradingViewConfig("theme-config");
    expect(config.studiesOverrides).toMatchObject({
      "relative strength index.length": 14,
    });
    expect(config.studiesOverrides).not.toHaveProperty("moving average.length");
  });
});
