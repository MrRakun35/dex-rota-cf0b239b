/* eslint-disable @typescript-eslint/no-explicit-any -- TradingView does not export types for its imperative order-line API. */
import { useCallback, useEffect, useRef } from "react";
import {
  useMarkPrice,
  usePositionStream,
  useSymbolsInfo,
} from "@orderly.network/hooks";
import { toast } from "@orderly.network/ui";

function getThemeColor(cssVarName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVarName)
    .trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/).map(Number);
  return parts.length === 3 && !parts.some(Number.isNaN)
    ? `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`
    : raw;
}

function getOrderlyThreshold(chart: any): number {
  try {
    const priceScale = chart?.getPanes?.()?.[0]?.getRightPriceScales?.()?.[0];
    const range = priceScale?.getVisiblePriceRange?.();
    if (
      range &&
      typeof range.from === "number" &&
      typeof range.to === "number"
    ) {
      const width = Math.abs(range.to - range.from);
      if (width > 0) return width * 0.02;
    }
  } catch {
    // The chart can be between symbols while its panes are rebuilding.
  }
  return 0;
}

function getActiveChart(): any | null {
  if (typeof window === "undefined") return null;
  const widget = (window as any).__rotaOrderlyTvWidget;
  try {
    const chart = widget?.activeChart?.();
    if (chart) return chart;
  } catch {
    // Fall through to the same-origin chart iframe lookup.
  }

  const iframe = document.querySelector(
    'iframe[id^="tradingview_"]',
  ) as HTMLIFrameElement | null;
  try {
    return (
      (iframe?.contentWindow as any)?.tradingViewApi?.activeChart?.() ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Adds a draggable TSL affordance near the position cost line. Active TSL
 * rendering and cancellation remain owned by Orderly's native chart adapter.
 */
export function useTSLChartLine(symbol: string) {
  const { data: markPrice } = useMarkPrice(symbol);
  const [positionsData] = usePositionStream("all");
  const symbolInfoMap = useSymbolsInfo();
  const quoteDp = symbolInfoMap[symbol]?.()?.quote_dp ?? 2;
  const position = positionsData?.rows?.find((row) => row.symbol === symbol);

  const positionRef = useRef(position);
  const markPriceRef = useRef(markPrice);
  const quoteDpRef = useRef(quoteDp);
  const triggerLineRef = useRef<any>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  useEffect(() => {
    markPriceRef.current = markPrice;
  }, [markPrice]);
  useEffect(() => {
    quoteDpRef.current = quoteDp;
  }, [quoteDp]);

  // Capture widgets created after mount and restore the original constructor
  // when this trading page unmounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let hookedLibrary: any = null;
    let originalWidget: any = null;
    let wrappedWidget: any = null;

    const hook = () => {
      const library = (window as any).TradingView;
      if (!library?.widget || library.__rotaTslWidgetHooked) return;
      hookedLibrary = library;
      originalWidget = library.widget;
      wrappedWidget = function (...args: any[]) {
        const widget = new originalWidget(...args);
        (window as any).__rotaOrderlyTvWidget = widget;
        return widget;
      };
      library.widget = wrappedWidget;
      library.__rotaTslWidgetHooked = true;
    };

    hook();
    const timer = globalThis.setInterval(hook, 250);
    return () => {
      globalThis.clearInterval(timer);
      if (hookedLibrary?.widget === wrappedWidget) {
        hookedLibrary.widget = originalWidget;
        delete hookedLibrary.__rotaTslWidgetHooked;
      }
    };
  }, []);

  const removeTrigger = useCallback(() => {
    if (!triggerLineRef.current) return;
    try {
      triggerLineRef.current.remove();
    } catch {
      // Chart may already have removed the line during a symbol change.
    }
    triggerLineRef.current = null;
  }, []);

  const ensureTrigger = useCallback(
    (chart: any, entryPrice: number) => {
      const currentPosition = positionRef.current;
      if (!chart || !currentPosition || triggerLineRef.current) return;

      let line: any = null;
      try {
        line = chart.createOrderLine();
        if (!line) return;

        const warning = getThemeColor("--oui-color-warning", "#FFD146");
        const background = getThemeColor("--oui-color-base-9", "#16141C");
        line
          .setCancellable(false)
          .setEditable(true)
          .setExtendLeft(true)
          .setLineLength(-280, "pixel")
          .setPrice(entryPrice)
          .setText("TSL")
          .setQuantity("")
          .setTooltip("Drag to set Trailing Stop Loss")
          .setBodyTextColor(warning)
          .setBodyBackgroundColor(background)
          .setBodyBorderColor(warning)
          .setQuantityBackgroundColor(background)
          .setQuantityBorderColor(warning)
          .setQuantityTextColor(warning)
          .setLineColor("rgba(0,0,0,0)")
          .setLineStyle(3);

        line.onMoving(() => {
          draggingRef.current = true;
          const draggedPrice = Number(line.getPrice());
          const latestPosition = positionRef.current;
          const currentMark = Number(
            markPriceRef.current ||
              latestPosition?.mark_price ||
              latestPosition?.average_open_price,
          );
          if (!latestPosition || !draggedPrice || !currentMark) return;

          const isLong = Number(latestPosition.position_qty) > 0;
          const directionalDistance = isLong
            ? currentMark - draggedPrice
            : draggedPrice - currentMark;
          const ratio = directionalDistance / currentMark;
          const normalizedRatio = Math.max(
            0.001,
            Math.min(0.05, Math.round(ratio / 0.001) * 0.001),
          );
          const targetPrice = isLong
            ? currentMark * (1 - normalizedRatio)
            : currentMark * (1 + normalizedRatio);

          line
            .setPrice(targetPrice)
            .setLineColor(warning)
            .setLineStyle(1)
            .setText(`TSL ${(normalizedRatio * 100).toFixed(1)}%`)
            .setQuantity(`$${targetPrice.toFixed(quoteDpRef.current)}`);
        });

        line.onMove(() => {
          draggingRef.current = false;
          const finalPrice = Number(line.getPrice());
          const latestPosition = positionRef.current;
          const currentMark = Number(
            markPriceRef.current ||
              latestPosition?.mark_price ||
              latestPosition?.average_open_price,
          );
          removeTrigger();
          if (!latestPosition || !finalPrice || !currentMark) return;

          const isLong = Number(latestPosition.position_qty) > 0;
          if (
            (isLong && finalPrice >= currentMark) ||
            (!isLong && finalPrice <= currentMark)
          ) {
            toast.error(
              `TSL for a ${isLong ? "long" : "short"} position must be dragged ${isLong ? "below" : "above"} mark price.`,
            );
            return;
          }

          const ratio = Math.abs(finalPrice - currentMark) / currentMark;
          const normalizedRatio = Math.max(
            0.001,
            Math.min(0.05, Math.round(ratio / 0.001) * 0.001),
          );
          window.dispatchEvent(
            new CustomEvent("open-tsl-dialog", {
              detail: {
                position: latestPosition,
                initialCallbackRate: (normalizedRatio * 100).toFixed(1),
              },
            }),
          );
        });

        triggerLineRef.current = line;
      } catch {
        try {
          line?.remove?.();
        } catch {
          // Ignore a partially-created TradingView line.
        }
      }
    },
    [removeTrigger],
  );

  useEffect(() => {
    let subscription: any = null;
    let removeTimer: ReturnType<typeof setTimeout> | null = null;
    let attachedChart: any = null;

    const attach = () => {
      const chart = getActiveChart();
      if (!chart || chart === attachedChart) return;
      try {
        subscription?.unsubscribe?.();
        attachedChart = chart;
        subscription = chart.crossHairMoved().subscribe(null, (event: any) => {
          if (draggingRef.current) return;
          const latestPosition = positionRef.current;
          const entryPrice = Number(latestPosition?.average_open_price);
          if (
            !latestPosition ||
            !entryPrice ||
            typeof event?.price !== "number"
          ) {
            return;
          }

          const threshold = getOrderlyThreshold(chart);
          const isNear =
            threshold > 0 && Math.abs(entryPrice - event.price) < threshold;
          if (isNear) {
            if (removeTimer) globalThis.clearTimeout(removeTimer);
            removeTimer = null;
            ensureTrigger(chart, entryPrice);
          } else if (!removeTimer && triggerLineRef.current) {
            removeTimer = globalThis.setTimeout(() => {
              if (!draggingRef.current) removeTrigger();
              removeTimer = null;
            }, 120);
          }
        });
      } catch {
        attachedChart = null;
      }
    };

    attach();
    const timer = globalThis.setInterval(attach, 500);
    return () => {
      globalThis.clearInterval(timer);
      if (removeTimer) globalThis.clearTimeout(removeTimer);
      try {
        subscription?.unsubscribe?.();
      } catch {
        // Ignore subscriptions already disposed by TradingView.
      }
      removeTrigger();
    };
  }, [ensureTrigger, removeTrigger, symbol]);
}
