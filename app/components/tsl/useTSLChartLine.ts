import { useEffect, useRef, useCallback } from "react";
import {
  useOrderStream,
  usePositionStream,
  useMarkPrice,
  useSymbolsInfo,
  useMutation,
  useSubAccountMutation,
  useSubAccountAlgoOrderStream,
  useAccount,
  useEventEmitter,
} from "@orderly.network/hooks";
import { AlgoOrderRootType, OrderStatus } from "@orderly.network/types";
import { toast } from "@orderly.network/ui";

// Theme color helper to dynamically derive colors from app theme CSS variables
function getThemeColor(cssVarName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(cssVarName)
      .trim();
    if (!raw) return fallback;
    const parts = raw.split(/\s+/).map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
    }
    return raw;
  } catch {
    return fallback;
  }
}

/**
 * Calculates hover threshold matching Orderly's TPSLService.generateThreshold().
 * It uses 2% of the currently visible vertical price range on the active chart
 * so TSL triggers at the exact same mouse proximity as the native TP/SL button.
 */
function getOrderlyThreshold(chart: any): number {
  try {
    const panes = chart?.getPanes?.();
    const priceScale = panes?.[0]?.getRightPriceScales?.()?.[0];
    if (priceScale) {
      const priceRange = priceScale.getVisiblePriceRange?.();
      if (
        priceRange &&
        typeof priceRange.from === "number" &&
        typeof priceRange.to === "number"
      ) {
        const priceWidth = Math.abs(priceRange.to - priceRange.from);
        if (priceWidth > 0) {
          return Math.min(priceWidth * 0.02, priceWidth);
        }
      }
    }
  } catch {
    // fallback
  }
  return 10;
}

export function useTSLChartLine(symbol: string) {
  const ee = useEventEmitter();
  const { account } = useAccount();
  const { data: markPrice } = useMarkPrice(symbol);
  const [positionsData] = usePositionStream("all");
  const symbolInfoMap = useSymbolsInfo();
  const symbolInfo = symbol ? symbolInfoMap[symbol]?.() : undefined;
  const quoteDp = symbolInfo?.quote_dp ?? 2;

  const matchingPosition = positionsData?.rows?.find(
    (p: any) => p.symbol === symbol,
  );

  const isSubAccount = Boolean(
    matchingPosition?.account_id &&
    account?.accountId &&
    matchingPosition.account_id !== account.accountId,
  );

  // Active trailing stop orders - main account
  const [mainAlgoOrders] = useOrderStream(
    {
      status: OrderStatus.INCOMPLETE,
      includes: [AlgoOrderRootType.TRAILING_STOP],
    },
    { keeplive: true },
  );

  // Active trailing stop orders - sub account
  const [subAlgoOrders] = useSubAccountAlgoOrderStream(
    {
      status: OrderStatus.INCOMPLETE,
      includes: [AlgoOrderRootType.TRAILING_STOP],
    },
    { accountId: matchingPosition?.account_id || account?.accountId || "" },
  );

  const algoOrders = isSubAccount ? subAlgoOrders : mainAlgoOrders;

  const activeTSLOrder = algoOrders?.find(
    (order: any) =>
      order.symbol === symbol &&
      (order.algo_type === "TRAILING_STOP" ||
        order.algo_type === AlgoOrderRootType.TRAILING_STOP),
  );

  const orderLineRef = useRef<any>(null);
  const chartRef = useRef<any>(null);
  const tslOrderRef = useRef<any>(null);
  const positionRef = useRef<any>(null);
  const currentTriggerPriceRef = useRef<number | null>(null);
  const handleMoveRef = useRef<((price: number) => void) | null>(null);
  const handleCancelRef = useRef<(() => void) | null>(null);

  // Refs for TSL trigger button on position cost line
  const markPriceRef = useRef<number | undefined>(markPrice);
  const quoteDpRef = useRef<number>(quoteDp);
  const tslTriggerLineRef = useRef<any>(null);
  const activeTPSLLineRef = useRef<any>(null);
  const isDraggingTriggerRef = useRef<boolean>(false);
  const isDraggingActiveLineRef = useRef<boolean>(false);
  const ensureTSLTriggerButtonRef = useRef<
    ((activeChart: any, entryPrice: number, tpslLine?: any) => void) | null
  >(null);

  // Keep refs up to date for callbacks
  useEffect(() => {
    tslOrderRef.current = activeTSLOrder;
  }, [activeTSLOrder]);

  useEffect(() => {
    positionRef.current = matchingPosition;
  }, [matchingPosition]);

  useEffect(() => {
    markPriceRef.current = markPrice;
  }, [markPrice]);

  useEffect(() => {
    quoteDpRef.current = quoteDp;
  }, [quoteDp]);

  // Main account mutations
  const [doMainCreate] = useMutation("/v1/algo/order");
  const [doMainUpdate] = useMutation("/v1/algo/order", "PUT");
  const [doMainDelete] = useMutation("/v1/algo/order", "DELETE");

  // Sub account mutations
  const [doSubCreate] = useSubAccountMutation("/v1/algo/order", "POST", {
    accountId: matchingPosition?.account_id || "",
  });
  const [doSubUpdate] = useSubAccountMutation("/v1/algo/order", "PUT", {
    accountId: matchingPosition?.account_id || "",
  });
  const [doSubDelete] = useSubAccountMutation("/v1/algo/order", "DELETE", {
    accountId: matchingPosition?.account_id || "",
  });

  const doCreate = isSubAccount ? doSubCreate : doMainCreate;
  const doUpdate = isSubAccount ? doSubUpdate : doMainUpdate;
  const doDelete = isSubAccount ? doSubDelete : doMainDelete;

  // Cancel TSL order handler (for close button on chart)
  const handleCancel = useCallback(async () => {
    const order = tslOrderRef.current;
    const pos = positionRef.current;
    if (!order?.algo_order_id || !pos?.symbol) return;

    try {
      const res = await doDelete(null, {
        order_id: order.algo_order_id,
        symbol: pos.symbol,
      });
      if (res && res.success === false) {
        toast.error(res.message || "Failed to cancel TSL.");
      } else {
        toast.success("Trailing Stop Loss cancelled.");
        ee.emit("order:changed", { symbol: pos.symbol });
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel TSL.");
    }
  }, [doDelete, ee]);

  // Update TSL after drag (for drag-and-drop on chart)
  const handleMove = useCallback(
    async (newPrice: number) => {
      const order = tslOrderRef.current;
      const pos = positionRef.current;
      if (!order?.algo_order_id || !pos?.symbol) return;

      const isLong = (pos.position_qty ?? 0) > 0;
      const currentMark = markPrice ?? pos.mark_price ?? pos.average_open_price;
      if (!currentMark) return;

      const resetLine = () => {
        if (orderLineRef.current && currentTriggerPriceRef.current) {
          try {
            orderLineRef.current.setPrice(currentTriggerPriceRef.current);
          } catch {
            // ignore
          }
        }
      };

      // Validate: for long positions TSL must be below mark, for short above
      if (isLong && newPrice >= currentMark) {
        toast.error("TSL price must be below current mark price.");
        resetLine();
        return;
      }
      if (!isLong && newPrice <= currentMark) {
        toast.error("TSL price must be above current mark price.");
        resetLine();
        return;
      }

      const refPrice = order.extreme_price
        ? Number(order.extreme_price)
        : currentMark;
      const distance = Math.abs(refPrice - newPrice);

      const rateRatio = distance / refPrice;
      if (rateRatio < 0.0005) {
        toast.error("TSL callback rate must be at least 0.1%.");
        resetLine();
        return;
      }
      if (rateRatio > 0.0505) {
        toast.error("TSL callback rate cannot exceed 5.0%.");
        resetLine();
        return;
      }

      // Step with 0.1% tick (0.001 in decimal ratio)
      const tick = 0.001;
      const roundedRate = Math.round(rateRatio / tick) * tick;
      const clampedRate = Math.max(
        0.001,
        Math.min(0.05, Number(roundedRate.toFixed(4))),
      );
      const percentValue = (clampedRate * 100).toFixed(1);

      const quoteTick = symbolInfo?.quote_tick || 0.01;
      const rawVal = refPrice * clampedRate;
      const steppedVal = Math.max(
        quoteTick,
        Math.round(rawVal / quoteTick) * quoteTick,
      );
      const callbackValue = Number(steppedVal.toFixed(quoteDp));

      const snappedPrice = isLong
        ? refPrice * (1 - clampedRate)
        : refPrice * (1 + clampedRate);

      if (orderLineRef.current) {
        try {
          orderLineRef.current.setPrice(snappedPrice);
          orderLineRef.current.setText(`TSL (${percentValue}%)`);
          orderLineRef.current.setQuantity(`$${snappedPrice.toFixed(quoteDp)}`);
        } catch {
          // ignore
        }
      }

      // Check whether existing order was set up using callback_rate or callback_value
      const isRateBased = Boolean(
        order.callback_rate !== undefined &&
        order.callback_rate !== null &&
        Number(order.callback_rate) > 0,
      );

      const isWholePercent =
        Math.abs(clampedRate * 100 - Math.round(clampedRate * 100)) < 0.01;

      // API strictly requires ONE of callback_rate or callback_value
      const payload: Record<string, any> = {
        order_id: order.algo_order_id,
      };

      if (isRateBased && isWholePercent) {
        payload.callback_rate = clampedRate.toFixed(2);
      } else {
        payload.callback_value = callbackValue;
      }

      // Preserve activated_price if set
      if (order.activated_price) {
        payload.activated_price = order.activated_price;
      }

      try {
        let res = await doUpdate(payload);
        if (res && res.success === false) {
          // If update failed due to backend tick validator or parameter switching, cancel and recreate
          const isTickOrParamError =
            res.message?.includes("tick 0.01") ||
            res.message?.includes("callback") ||
            res.message?.includes("order_id");

          if (isTickOrParamError) {
            const delRes = await doDelete(null, {
              order_id: order.algo_order_id,
              symbol: pos.symbol,
            });
            if (delRes?.success !== false) {
              const createPayload: Record<string, any> = {
                symbol: pos.symbol,
                algo_type: "TRAILING_STOP",
                type: "MARKET",
                trigger_price_type: "MARK_PRICE",
                quantity: Number(
                  order.quantity ?? Math.abs(pos.position_qty ?? 0),
                ),
                side: pos.position_qty > 0 ? "SELL" : "BUY",
                reduce_only: true,
                margin_mode: pos.margin_mode ?? "CROSS",
                callback_value: callbackValue,
                ...(order.activated_price
                  ? { activated_price: order.activated_price }
                  : {}),
              };
              res = await doCreate(createPayload);
            }
          }
        }

        if (res && res.success === false) {
          toast.error(res.message || "Failed to update TSL.");
          resetLine();
        } else {
          toast.success(
            `TSL updated: ${percentValue}% ($${snappedPrice.toFixed(quoteDp)})`,
          );
          ee.emit("order:changed", { symbol: pos.symbol });
        }
      } catch (err: any) {
        toast.error(err?.message || "Failed to update TSL.");
        resetLine();
      }
    },
    [
      doUpdate,
      doDelete,
      doCreate,
      markPrice,
      quoteDp,
      ee,
      symbolInfo?.quote_tick,
    ],
  );

  // Keep handler refs up to date
  useEffect(() => {
    handleMoveRef.current = handleMove;
  }, [handleMove]);

  useEffect(() => {
    handleCancelRef.current = handleCancel;
  }, [handleCancel]);

  // Setup TradingView widget interceptor if not already hooked
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hookTradingView = () => {
      const tv = (window as any).TradingView;
      if (tv && !tv.__tslHooked) {
        tv.__tslHooked = true;
        const OrigWidget = tv.widget;
        tv.widget = function (...args: any[]) {
          const inst = new OrigWidget(...args);
          (window as any).__orderlyTvWidget = inst;
          return inst;
        };
      }
    };

    hookTradingView();
    const interval = setInterval(hookTradingView, 250);
    return () => clearInterval(interval);
  }, []);

  // Helper to obtain TradingView activeChart
  const getActiveChart = () => {
    if (typeof window === "undefined") return null;

    const widget = (window as any).__orderlyTvWidget;
    if (widget) {
      try {
        const chart = widget.activeChart?.();
        if (chart) return chart;
      } catch {
        // ignore if not ready
      }
    }

    const iframe = document.querySelector(
      'iframe[id^="tradingview_"]',
    ) as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      try {
        const innerApi = (iframe.contentWindow as any).tradingViewApi;
        if (innerApi && typeof innerApi.activeChart === "function") {
          const chart = innerApi.activeChart();
          if (chart) return chart;
        }
      } catch {
        // cross-origin or loading
      }
    }

    return null;
  };

  // Ensure TSL trigger button on position cost line (matches TP/SL trigger button)
  const ensureTSLTriggerButton = useCallback(
    (activeChart: any, entryPrice: number, tpslLine?: any) => {
      if (!activeChart || !positionRef.current) return;

      if (tslTriggerLineRef.current) {
        if (!isDraggingTriggerRef.current && entryPrice) {
          try {
            tslTriggerLineRef.current.setPrice(entryPrice);
          } catch {
            // ignore
          }
        }
        return;
      }

      try {
        (activeChart as any).__creatingCustomTSL = true;
        const triggerLine = activeChart.createOrderLine();
        (activeChart as any).__creatingCustomTSL = false;

        if (!triggerLine) return;

        const tslColor = getThemeColor("--oui-color-warning", "#FFD146");
        const bgColor = getThemeColor("--oui-color-base-9", "#16141C");

        triggerLine
          .setCancellable(false)
          .setEditable(true)
          .setExtendLeft(true)
          .setLineLength(-280, "pixel")
          .setPrice(entryPrice)
          .setText("TSL")
          .setQuantity("")
          .setTooltip("Drag to set Trailing Stop Loss")
          .setBodyTextColor(tslColor)
          .setBodyBackgroundColor(bgColor)
          .setBodyBorderColor(tslColor)
          .setQuantityBackgroundColor(bgColor)
          .setQuantityBorderColor(tslColor)
          .setQuantityTextColor(tslColor)
          .setLineColor("rgba(0,0,0,0)") // transparent line while hovering, button only
          .setLineStyle(3);

        // onMoving: while user drags the button
        triggerLine.onMoving(() => {
          isDraggingTriggerRef.current = true;
          const currentDraggedPrice = triggerLine.getPrice();
          if (!currentDraggedPrice || currentDraggedPrice <= 0) return;

          const pos = positionRef.current;
          const isLong = (pos?.position_qty ?? 0) > 0;
          const currentMark =
            markPriceRef.current ?? pos?.mark_price ?? entryPrice;
          const dp = quoteDpRef.current;

          // Enforce directional rules:
          // "Long için aşağı sürükleme short için yukarı sürüklemeye izin verecek"
          if (isLong) {
            // Long position: strictly allow dragging downwards
            if (currentDraggedPrice >= currentMark) {
              const clamped = currentMark * (1 - 0.001);
              try {
                triggerLine.setPrice(clamped);
                triggerLine.setText("TSL (Drag down ↓)");
                triggerLine.setQuantity("");
                triggerLine.setLineColor(tslColor);
                triggerLine.setLineStyle(1);
              } catch {
                // ignore
              }
              return;
            }

            const distance = currentMark - currentDraggedPrice;
            const rateRatio = distance / currentMark;
            const tick = 0.001; // 0.1% tick
            const roundedRate = Math.round(rateRatio / tick) * tick;
            const clampedRate = Math.max(
              0.001,
              Math.min(0.05, Number(roundedRate.toFixed(4))),
            );
            const ratePercent = (clampedRate * 100).toFixed(1);
            const targetPrice = currentMark * (1 - clampedRate);

            try {
              triggerLine.setPrice(targetPrice);
              triggerLine.setLineColor(tslColor);
              triggerLine.setLineStyle(1); // dashed line while dragging
              triggerLine.setText(`TSL -${ratePercent}%`);
              triggerLine.setQuantity(`$${targetPrice.toFixed(dp)}`);
            } catch {
              // ignore
            }
          } else {
            // Short position: strictly allow dragging upwards
            if (currentDraggedPrice <= currentMark) {
              const clamped = currentMark * (1 + 0.001);
              try {
                triggerLine.setPrice(clamped);
                triggerLine.setText("TSL (Drag up ↑)");
                triggerLine.setQuantity("");
                triggerLine.setLineColor(tslColor);
                triggerLine.setLineStyle(1);
              } catch {
                // ignore
              }
              return;
            }

            const distance = currentDraggedPrice - currentMark;
            const rateRatio = distance / currentMark;
            const tick = 0.001; // 0.1% tick
            const roundedRate = Math.round(rateRatio / tick) * tick;
            const clampedRate = Math.max(
              0.001,
              Math.min(0.05, Number(roundedRate.toFixed(4))),
            );
            const ratePercent = (clampedRate * 100).toFixed(1);
            const targetPrice = currentMark * (1 + clampedRate);

            try {
              triggerLine.setPrice(targetPrice);
              triggerLine.setLineColor(tslColor);
              triggerLine.setLineStyle(1); // dashed line while dragging
              triggerLine.setText(`TSL +${ratePercent}%`);
              triggerLine.setQuantity(`$${targetPrice.toFixed(dp)}`);
            } catch {
              // ignore
            }
          }
        });

        // onMove: when user drops the drag
        triggerLine.onMove(() => {
          isDraggingTriggerRef.current = false;
          const finalPrice = triggerLine.getPrice();
          const pos = positionRef.current;
          const isLong = (pos?.position_qty ?? 0) > 0;
          const currentMark =
            markPriceRef.current ?? pos?.mark_price ?? entryPrice;

          try {
            triggerLine.remove();
          } catch {
            // ignore
          }
          tslTriggerLineRef.current = null;

          if (!finalPrice || !pos) return;

          if (isLong && finalPrice >= currentMark) {
            toast.error("TSL for Long position must be dragged downwards.");
            return;
          }
          if (!isLong && finalPrice <= currentMark) {
            toast.error("TSL for Short position must be dragged upwards.");
            return;
          }

          const distance = Math.abs(finalPrice - currentMark);
          const rateRatio = distance / currentMark;
          const tick = 0.001;
          const roundedRate = Math.round(rateRatio / tick) * tick;
          const clampedRate = Math.max(
            0.001,
            Math.min(0.05, Number(roundedRate.toFixed(4))),
          );
          const ratePercent = (clampedRate * 100).toFixed(1);

          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("open-tsl-dialog", {
                detail: {
                  position: pos,
                  initialCallbackRate: ratePercent,
                },
              }),
            );
          }
          toast.success(
            `TSL rate ${ratePercent}% selected. Confirm to place order.`,
          );
        });

        if (tpslLine && typeof tpslLine.remove === "function") {
          const origTpslRemove = tpslLine.remove.bind(tpslLine);
          tpslLine.remove = function () {
            if (!isDraggingTriggerRef.current && tslTriggerLineRef.current) {
              try {
                tslTriggerLineRef.current.remove();
              } catch {
                // ignore
              }
              tslTriggerLineRef.current = null;
            }
            return origTpslRemove();
          };
        }

        tslTriggerLineRef.current = triggerLine;
      } catch (err) {
        // ignore
      }
    },
    [],
  );

  useEffect(() => {
    ensureTSLTriggerButtonRef.current = ensureTSLTriggerButton;
  }, [ensureTSLTriggerButton]);

  // Intercept native order lines to hide duplicate TSL lines
  // and attach TSL trigger button on position cost line
  useEffect(() => {
    let crossHairSub: any = null;
    let clearTriggerTimer: any = null;

    const setupInterceptor = () => {
      const activeChart = getActiveChart();
      if (!activeChart || (activeChart as any).__tslNativeHidden) return;

      (activeChart as any).__tslNativeHidden = true;
      const origCreateOrderLine = activeChart.createOrderLine.bind(activeChart);

      activeChart.createOrderLine = function () {
        const line = origCreateOrderLine();
        if (!line) return line;

        // If this is our own custom TSL line creation, skip interception
        if ((activeChart as any).__creatingCustomTSL) {
          return line;
        }

        // Wrap setText to detect native TSL/Trailing lines & TP/SL trigger button
        const origSetText = line.setText.bind(line);
        let isNativeTSL = false;
        let isTPSLTrigger = false;

        line.setText = function (text: string) {
          // Detect native trailing stop line by its text
          if (
            text &&
            typeof text === "string" &&
            (text.includes("Trailing") || text.includes("trailing"))
          ) {
            isNativeTSL = true;
          }

          if (isNativeTSL) {
            // Hide the native line by making it invisible
            try {
              line.setLineColor("rgba(0,0,0,0)");
              line.setBodyTextColor("rgba(0,0,0,0)");
              line.setBodyBorderColor("rgba(0,0,0,0)");
              line.setBodyBackgroundColor("rgba(0,0,0,0)");
              line.setQuantityTextColor("rgba(0,0,0,0)");
              line.setQuantityBorderColor("rgba(0,0,0,0)");
              line.setQuantityBackgroundColor("rgba(0,0,0,0)");
              line.setCancelButtonIconColor("rgba(0,0,0,0)");
              line.setCancelButtonBorderColor("rgba(0,0,0,0)");
              line.setCancelButtonBackgroundColor("rgba(0,0,0,0)");
              line.setCancellable(false);
              line.setEditable(false);
              line.setLineLength(0);
            } catch {
              // ignore styling errors
            }
            return origSetText("");
          }

          // Detect native TP/SL trigger button on position cost line
          if (
            text &&
            typeof text === "string" &&
            (text === "TP/SL" ||
              text.includes("TP/SL") ||
              text.toLowerCase().includes("tpsl") ||
              text.includes("止盈"))
          ) {
            isTPSLTrigger = true;
            activeTPSLLineRef.current = line;
            const entryPrice = line.getPrice();
            if (entryPrice && entryPrice > 0) {
              ensureTSLTriggerButtonRef.current?.(
                activeChart,
                entryPrice,
                line,
              );
            }
          }

          return origSetText(text);
        };

        // Wrap line.remove to clean up trigger button when TP/SL is cleared
        const origRemove = line.remove ? line.remove.bind(line) : null;
        if (origRemove) {
          line.remove = function () {
            if (isTPSLTrigger) {
              activeTPSLLineRef.current = null;
              if (!isDraggingTriggerRef.current && tslTriggerLineRef.current) {
                try {
                  tslTriggerLineRef.current.remove();
                } catch {
                  // ignore
                }
                tslTriggerLineRef.current = null;
              }
            }
            return origRemove();
          };
        }

        // Also wrap setPrice to re-apply hiding after native refreshes & sync price
        const origSetPrice = line.setPrice.bind(line);
        line.setPrice = function (price: number) {
          const result = origSetPrice(price);
          if (isNativeTSL) {
            try {
              line.setLineColor("rgba(0,0,0,0)");
              line.setBodyTextColor("rgba(0,0,0,0)");
              line.setBodyBorderColor("rgba(0,0,0,0)");
              line.setBodyBackgroundColor("rgba(0,0,0,0)");
              line.setQuantityTextColor("rgba(0,0,0,0)");
              line.setQuantityBorderColor("rgba(0,0,0,0)");
              line.setQuantityBackgroundColor("rgba(0,0,0,0)");
              line.setCancelButtonIconColor("rgba(0,0,0,0)");
              line.setCancelButtonBorderColor("rgba(0,0,0,0)");
              line.setCancelButtonBackgroundColor("rgba(0,0,0,0)");
              line.setCancellable(false);
              line.setEditable(false);
              line.setLineLength(0);
            } catch {
              // ignore
            }
          }
          if (
            isTPSLTrigger &&
            tslTriggerLineRef.current &&
            !isDraggingTriggerRef.current &&
            price
          ) {
            try {
              tslTriggerLineRef.current.setPrice(price);
            } catch {
              // ignore
            }
          }
          return result;
        };

        return line;
      };

      // Also listen to crossHairMoved for smooth hover detection near position line
      // Matching Orderly's TPSLService 2% visible price range threshold and 100ms debounce
      try {
        crossHairSub = activeChart
          .crossHairMoved()
          .subscribe(null, (args: any) => {
            if (isDraggingTriggerRef.current) return;
            const pos = positionRef.current;
            if (!pos || !args || typeof args.price !== "number") return;
            const openPrice = Number(pos.average_open_price ?? pos.open);
            if (!openPrice || isNaN(openPrice)) return;

            // Use exact same threshold as Orderly's TPSLService (2% of visible price range)
            const threshold = getOrderlyThreshold(activeChart);
            const isNearPosition = Math.abs(openPrice - args.price) < threshold;

            if (isNearPosition) {
              if (clearTriggerTimer) {
                clearTimeout(clearTriggerTimer);
                clearTriggerTimer = null;
              }
              ensureTSLTriggerButtonRef.current?.(activeChart, openPrice);
            } else {
              if (!clearTriggerTimer && tslTriggerLineRef.current) {
                // Match Orderly's 100ms remove debounce timer
                clearTriggerTimer = setTimeout(() => {
                  if (
                    !isDraggingTriggerRef.current &&
                    tslTriggerLineRef.current
                  ) {
                    try {
                      tslTriggerLineRef.current.remove();
                    } catch {
                      // ignore
                    }
                    tslTriggerLineRef.current = null;
                  }
                  clearTriggerTimer = null;
                }, 100);
              }
            }
          });
      } catch {
        // ignore if crossHairMoved subscribe fails
      }
    };

    setupInterceptor();
    const timer = setInterval(setupInterceptor, 500);

    return () => {
      clearInterval(timer);
      if (clearTriggerTimer) clearTimeout(clearTriggerTimer);
      try {
        crossHairSub?.unsubscribe?.();
      } catch {
        // ignore
      }
      if (tslTriggerLineRef.current) {
        try {
          tslTriggerLineRef.current.remove();
        } catch {
          // ignore
        }
        tslTriggerLineRef.current = null;
      }
    };
  }, []);

  // Synchronize Yellow TSL Line on the chart
  useEffect(() => {
    let timer: any = null;

    const updateChartLine = () => {
      const activeChart = getActiveChart();
      if (!activeChart) {
        return;
      }
      chartRef.current = activeChart;

      // If no active TSL order, remove any existing line
      if (!activeTSLOrder || !matchingPosition || !markPrice) {
        if (orderLineRef.current) {
          try {
            orderLineRef.current.remove();
          } catch {
            // ignore
          }
          orderLineRef.current = null;
        }
        return;
      }

      const isLong = (matchingPosition.position_qty ?? 0) > 0;
      const callbackRate = activeTSLOrder.callback_rate
        ? Number(activeTSLOrder.callback_rate)
        : 0.01;
      const callbackValue = activeTSLOrder.callback_value
        ? Number(activeTSLOrder.callback_value)
        : null;

      // Calculate trailing price
      let triggerPrice = markPrice;
      if (activeTSLOrder.extreme_price) {
        const extreme = Number(activeTSLOrder.extreme_price);
        if (isLong) {
          triggerPrice = callbackValue
            ? extreme - callbackValue
            : extreme * (1 - callbackRate);
        } else {
          triggerPrice = callbackValue
            ? extreme + callbackValue
            : extreme * (1 + callbackRate);
        }
      } else {
        if (isLong) {
          triggerPrice = callbackValue
            ? markPrice - callbackValue
            : markPrice * (1 - callbackRate);
        } else {
          triggerPrice = callbackValue
            ? markPrice + callbackValue
            : markPrice * (1 + callbackRate);
        }
      }

      if (isNaN(triggerPrice) || triggerPrice <= 0) return;
      currentTriggerPriceRef.current = triggerPrice;

      const rateText = callbackValue
        ? `$${callbackValue}`
        : `${(callbackRate * 100).toFixed(1)}%`;
      const priceText = `$${triggerPrice.toFixed(quoteDp)}`;

      try {
        // Create order line if not already created
        if (!orderLineRef.current) {
          // Flag our own line creation so the interceptor skips it
          (activeChart as any).__creatingCustomTSL = true;
          const newLine = activeChart.createOrderLine();
          (activeChart as any).__creatingCustomTSL = false;

          if (!newLine) return;

          const tslWarningColor = getThemeColor(
            "--oui-color-warning",
            "#FFD146",
          );
          const tslBgColor = getThemeColor("--oui-color-base-9", "#16141C");
          const closeIconColor = "#FFFFFF";

          newLine
            .setCancellable(true)
            .setEditable(true)
            .setExtendLeft(true)
            .setLineLength(100)
            .setLineStyle(1) // Dashed
            .setLineWidth(1)
            .setLineColor(tslWarningColor)
            .setBodyTextColor(tslWarningColor)
            .setBodyBorderColor(tslWarningColor)
            .setBodyBackgroundColor(tslBgColor)
            .setQuantityBorderColor(tslWarningColor)
            .setQuantityTextColor(tslWarningColor)
            .setQuantityBackgroundColor(tslBgColor)
            .setCancelButtonIconColor(closeIconColor)
            .setCancelButtonBorderColor(tslWarningColor)
            .setCancelButtonBackgroundColor(tslBgColor)
            .setCancelTooltip("Cancel TSL")
            .setTooltip("Drag to adjust TSL price");

          // Close button — cancel the TSL order via ref (always up-to-date)
          newLine.onCancel(null, () => {
            handleCancelRef.current?.();
          });

          // Dragging — while user moves the active TSL order line, snap to 0.1% steps
          newLine.onMoving(() => {
            isDraggingActiveLineRef.current = true;
            const currentDraggedPrice = newLine.getPrice();
            if (!currentDraggedPrice || currentDraggedPrice <= 0) return;

            const pos = positionRef.current;
            const order = tslOrderRef.current;
            if (!pos) return;

            const isLong = (pos.position_qty ?? 0) > 0;
            const currentMark =
              markPriceRef.current ?? pos.mark_price ?? pos.average_open_price;
            if (!currentMark) return;

            const refPrice = order?.extreme_price
              ? Number(order.extreme_price)
              : currentMark;

            // Enforce directional boundary
            if (isLong && currentDraggedPrice >= refPrice) {
              const clamped = refPrice * (1 - 0.001);
              try {
                newLine.setPrice(clamped);
                newLine.setText("TSL (Must be below mark)");
              } catch {
                // ignore
              }
              return;
            }
            if (!isLong && currentDraggedPrice <= refPrice) {
              const clamped = refPrice * (1 + 0.001);
              try {
                newLine.setPrice(clamped);
                newLine.setText("TSL (Must be above mark)");
              } catch {
                // ignore
              }
              return;
            }

            const distance = Math.abs(refPrice - currentDraggedPrice);
            const rateRatio = distance / refPrice;
            const tick = 0.001; // 0.1% tick
            const roundedRate = Math.round(rateRatio / tick) * tick;
            const clampedRate = Math.max(
              0.001,
              Math.min(0.05, Number(roundedRate.toFixed(4))),
            );
            const ratePercent = (clampedRate * 100).toFixed(1);
            const targetPrice = isLong
              ? refPrice * (1 - clampedRate)
              : refPrice * (1 + clampedRate);
            const dp = quoteDpRef.current;

            try {
              newLine.setPrice(targetPrice);
              newLine.setText(`TSL (${ratePercent}%)`);
              newLine.setQuantity(`$${targetPrice.toFixed(dp)}`);
            } catch {
              // ignore
            }
          });

          // Drag — update TSL after drag is released via ref (always up-to-date)
          newLine.onMove(() => {
            isDraggingActiveLineRef.current = false;
            const newPrice = newLine.getPrice();
            if (newPrice && newPrice > 0) {
              handleMoveRef.current?.(newPrice);
            }
          });

          orderLineRef.current = newLine;
        }

        if (!isDraggingActiveLineRef.current && orderLineRef.current) {
          orderLineRef.current
            .setPrice(triggerPrice)
            .setText(`TSL (${rateText})`)
            .setQuantity(priceText);
        }
      } catch (err) {
        // Chart might be resetting or destroyed
        orderLineRef.current = null;
      }
    };

    updateChartLine();
    timer = setInterval(updateChartLine, 1000);

    return () => {
      if (timer) clearInterval(timer);
      if (orderLineRef.current) {
        try {
          orderLineRef.current.remove();
        } catch {
          // ignore
        }
        orderLineRef.current = null;
      }
      if (tslTriggerLineRef.current) {
        try {
          tslTriggerLineRef.current.remove();
        } catch {
          // ignore
        }
        tslTriggerLineRef.current = null;
      }
    };
  }, [activeTSLOrder, matchingPosition, markPrice, quoteDp, symbol]);

  return {
    hasActiveTSL: Boolean(activeTSLOrder),
    activeTSLOrder,
  };
}
