import type { IChartWidgetApi } from "../../public/tradingview/charting_library/charting_library";

const styledCharts = new WeakSet<IChartWidgetApi>();

/** PnL badges use bright profit/loss fills, unlike dark order labels. */
export function stylePositionLabels(chart: IChartWidgetApi) {
  if (styledCharts.has(chart)) return;
  const create = chart.createPositionLine.bind(chart);
  chart.createPositionLine = (...args) => {
    const line = create(...args);
    const setBackground = line.setBodyBackgroundColor.bind(line);
    line.setBodyBackgroundColor = (color) => {
      setBackground(color);
      line.setBodyTextColor("#080913");
      return line;
    };
    return line;
  };
  styledCharts.add(chart);
}
