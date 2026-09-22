import type { TradingPageProps } from "@orderly.network/trading";
import { withBasePath } from "./base-path";
import {
  getTradingViewColorConfigForSource,
  type DexThemeConfigResolution,
} from "./theme-config";

export const createTradingViewConfig = (
  source: DexThemeConfigResolution["source"],
): TradingPageProps["tradingViewConfig"] => ({
  scriptSRC: withBasePath("/tradingview/charting_library/charting_library.js"),
  library_path: withBasePath("/tradingview/charting_library/"),
  customCssUrl: withBasePath("/tradingview/chart.css"),
  colorConfig: getTradingViewColorConfigForSource(source),
  disabled_features: [
    "create_volume_indicator_by_default",
    "create_volume_indicator_by_default_once",
  ],
  studiesOverrides: {
    "relative strength index.length": 14,
  } as any,
});
