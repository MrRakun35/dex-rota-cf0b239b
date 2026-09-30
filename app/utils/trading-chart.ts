import type { IChartWidgetApi } from "../../public/tradingview/charting_library/charting_library";

type ChartHost = {
  __rotaOrderlyTvWidget?: { activeChart(): IChartWidgetApi };
  tradingViewApi?: { activeChart(): IChartWidgetApi };
};

export function getActiveTradingChart(): IChartWidgetApi | null {
  if (typeof window === "undefined") return null;
  try {
    const chart = (
      window as unknown as ChartHost
    ).__rotaOrderlyTvWidget?.activeChart();
    if (chart) return chart;
  } catch {
    /* The widget may be rebuilding. */
  }
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[id^="tradingview_"]',
  );
  try {
    return (
      (
        iframe?.contentWindow as unknown as ChartHost | null
      )?.tradingViewApi?.activeChart() ?? null
    );
  } catch {
    return null;
  }
}
