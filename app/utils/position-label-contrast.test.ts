import { describe, expect, it, vi } from "vitest";
import type { IChartWidgetApi } from "../../public/tradingview/charting_library/charting_library";
import { stylePositionLabels } from "./position-label-contrast";

describe("position label contrast", () => {
  it("uses dark text each time a profit/loss background changes", () => {
    const line = { setBodyBackgroundColor: vi.fn(), setBodyTextColor: vi.fn() };
    const setBackground = line.setBodyBackgroundColor;
    const chart = { createPositionLine: vi.fn(() => line) };
    stylePositionLabels(chart as unknown as IChartWidgetApi);
    const wrapped = chart.createPositionLine;
    stylePositionLabels(chart as unknown as IChartWidgetApi);
    expect(chart.createPositionLine).toBe(wrapped);
    const badge = chart.createPositionLine();
    for (const color of ["#28dda6", "#f15d79", "#777b91"]) {
      expect(badge.setBodyBackgroundColor(color)).toBe(line);
      expect(setBackground).toHaveBeenLastCalledWith(color);
      expect(line.setBodyTextColor).toHaveBeenLastCalledWith("#080913");
    }
  });
});
