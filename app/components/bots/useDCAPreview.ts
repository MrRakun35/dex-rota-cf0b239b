import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveTradingChart } from "@/utils/trading-chart";
import type {
  IChartWidgetApi,
  IOrderLineAdapter,
} from "../../../public/tradingview/charting_library/charting_library";
import { DCASettings } from "./DCAForm";
import { dcaPreviewLevels } from "./dca-preview";

export function useDCAPreview(
  symbol: string,
  settings: DCASettings,
  markPrice: number,
  enabled: boolean,
  validation: string,
) {
  const lines = useRef<IOrderLineAdapter[]>([]);
  const attached = useRef<IChartWidgetApi | null>(null);
  const restoreScale = useRef<(() => void) | null>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const dispose = useCallback(() => {
    for (const line of lines.current) {
      try {
        line.remove();
      } catch {
        /* Chart already disposed. */
      }
    }
    lines.current = [];
    try {
      restoreScale.current?.();
    } catch {
      /* Chart already disposed. */
    }
    restoreScale.current = null;
    attached.current = null;
  }, []);
  const clear = useCallback(() => {
    dispose();
    setVisible(false);
    setError("");
  }, [dispose]);
  useEffect(() => {
    clear();
    return dispose;
  }, [symbol, settings, enabled, clear, dispose]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        attached.current &&
        (getActiveTradingChart() !== attached.current ||
          attached.current.symbol() !== symbol)
      )
        clear();
    }, 500);
    return () => clearInterval(timer);
  }, [symbol, clear]);

  const preview = useCallback(() => {
    if (validation) {
      setError(validation);
      return;
    }
    const chart = getActiveTradingChart();
    if (!chart || chart.symbol() !== symbol) {
      setError(
        "The chart for this market is not ready. Open Chart and try Preview again.",
      );
      return;
    }
    dispose();
    const levels = dcaPreviewLevels(settings, markPrice);
    try {
      for (const level of levels) {
        const line = chart.createOrderLine();
        lines.current.push(line);
        line
          .setPrice(level.price)
          .setText(level.label)
          .setQuantity(
            level.quantity
              ? level.quantity.toLocaleString(undefined, {
                  maximumFractionDigits: 6,
                })
              : "",
          )
          .setEditable(false)
          .setCancellable(false)
          .setExtendLeft(true)
          .setLineLength(85)
          .setLineStyle(2)
          .setLineColor(level.color)
          .setBodyBorderColor(level.color)
          .setBodyTextColor(level.color)
          .setBodyBackgroundColor("#171923")
          .setQuantityBackgroundColor("#171923")
          .setQuantityBorderColor(level.color)
          .setQuantityTextColor(level.color)
          .setTooltip("DCA preview · projected price level");
      }
      const scale = chart.getPanes()[0]?.getMainSourcePriceScale();
      if (scale) {
        const range = scale.getVisiblePriceRange();
        const auto = scale.isAutoScale();
        restoreScale.current = () => {
          if (range && !auto) scale.setVisiblePriceRange(range);
          scale.setAutoScale(auto);
        };
        const prices = levels.map((level) => level.price);
        const low = Math.min(...prices, markPrice, range?.from ?? markPrice);
        const high = Math.max(...prices, markPrice, range?.to ?? markPrice);
        const padding = Math.max((high - low) * 0.08, markPrice * 0.002);
        scale.setAutoScale(false);
        scale.setVisiblePriceRange({
          from: Math.max(0, low - padding),
          to: high + padding,
        });
      }
      attached.current = chart;
      setVisible(true);
      setError("");
    } catch {
      dispose();
      setVisible(false);
      setError(
        "Preview could not be drawn. Wait for the chart to load and try again.",
      );
    }
  }, [symbol, settings, markPrice, dispose, validation]);
  return { preview, clear, visible, error };
}
