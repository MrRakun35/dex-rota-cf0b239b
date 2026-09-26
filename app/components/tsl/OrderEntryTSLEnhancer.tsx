import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  usePositionStream,
  useSymbolsInfo,
  useEventEmitter,
  useMarkPrice,
} from "@orderly.network/hooks";
import { OrderSide, OrderStatus } from "@orderly.network/types";
import { Switch, Input, Grid, Flex, cn, toast } from "@orderly.network/ui";
import {
  activationPriceError,
  floorToTick,
  getErrorMessage,
  normalizeCallbackPercent,
} from "./tsl-utils";
import { usePositionTSL } from "./usePositionTSL";

interface OrderEntryTSLEnhancerProps {
  symbol: string;
}

export const OrderEntryTSLEnhancer: React.FC<OrderEntryTSLEnhancerProps> = ({
  symbol,
}) => {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Form states in Order Entry card
  const [tslEnabled, setTslEnabled] = useState<boolean>(false);
  const [callbackRate, setCallbackRate] = useState<string>("1.0");
  const [activatedPrice, setActivatedPrice] = useState<string>("");
  const [selectedPercent, setSelectedPercent] = useState<number>(100);

  // Symbol info & Mark price
  const symbolInfoMap = useSymbolsInfo();
  const symbolInfo = symbol ? symbolInfoMap[symbol]?.() : undefined;
  const quoteToken = symbolInfo?.quote ?? "USDC";
  const { data: markPrice } = useMarkPrice(symbol);

  // Position stream to track when position opens or changes
  const [positionsData] = usePositionStream("all");
  const currentPos = positionsData?.rows?.find(
    (position) => position.symbol === symbol,
  );
  const currentPosQty = Math.abs(Number(currentPos?.position_qty ?? 0));
  const currentSignedQty = Number(currentPos?.position_qty ?? 0);

  // TSL submission hook
  const { submitTSL } = usePositionTSL(currentPos ?? undefined);
  const ee = useEventEmitter();

  // Armed state: when user submits an order with TSL checked
  const isArmedRef = useRef<boolean>(false);
  const armedParamsRef = useRef<{
    callbackRate: number;
    activatedPrice?: number;
    closePercent: number;
    side: OrderSide;
    initialPositionQty: number;
    expiresAt: number;
    fillSeen: boolean;
  } | null>(null);
  const [fillRevision, setFillRevision] = useState(0);

  // Helper to detect if Order Entry is currently on LIMIT or MARKET
  const isLimitOrMarket = useCallback((): boolean => {
    if (typeof document === "undefined") return false;

    const allTpsl = document.querySelectorAll(".oui-orderEntry-tpsl");
    for (let i = 0; i < allTpsl.length; i++) {
      if (!allTpsl[i].closest("#order-entry-tsl-host")) return true;
    }

    const limitBtn = document.querySelector(
      '[data-testid="oui-testid-orderEntry-orderType-limit"]',
    );
    if (limitBtn?.getAttribute("aria-pressed") === "true") return true;

    const marketBtn = document.querySelector(
      '[data-testid="oui-testid-orderEntry-orderType-market"]',
    );
    if (marketBtn?.getAttribute("aria-pressed") === "true") return true;

    const mobileBtn = document.querySelector(
      '[data-testid="oui-testid-orderEntry-orderType-button"]',
    );
    if (mobileBtn) {
      const text = (mobileBtn.textContent || "").toLowerCase();
      return (
        (text.includes("limit") ||
          text.includes("market") ||
          text.includes("piyasa")) &&
        !text.includes("stop") &&
        !text.includes("scaled") &&
        !text.includes("trailing")
      );
    }

    return false;
  }, []);

  // Keep armed state updated while TSL is enabled
  useEffect(() => {
    if (tslEnabled) {
      const rateNum = Number(callbackRate);
      if (!isNaN(rateNum) && rateNum >= 0.1 && rateNum <= 5.0) {
        const existing = armedParamsRef.current;
        armedParamsRef.current = existing
          ? {
              ...existing,
              callbackRate: Number(rateNum.toFixed(1)),
              activatedPrice: activatedPrice
                ? Number(activatedPrice)
                : undefined,
              closePercent: selectedPercent,
            }
          : null;
      }
    } else {
      armedParamsRef.current = null;
      isArmedRef.current = false;
    }
  }, [tslEnabled, callbackRate, activatedPrice, selectedPercent]);

  // Intercept order submission clicks to arm the TSL attacher
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleOrderSubmitClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Check if clicked element is inside order entry submit section
      const submitBtn = target.closest<HTMLButtonElement>(
        "#order-entry-submit-button",
      );
      if (!submitBtn) return;

      if (!submitBtn.disabled && tslEnabled && isLimitOrMarket()) {
        const normalizedRate = normalizeCallbackPercent(callbackRate);
        const side = submitBtn.classList.contains(
          "orderly-order-entry-submit-button-buy",
        )
          ? OrderSide.BUY
          : submitBtn.classList.contains(
                "orderly-order-entry-submit-button-sell",
              )
            ? OrderSide.SELL
            : undefined;
        const activationNumber = activatedPrice
          ? Number(activatedPrice)
          : undefined;
        const currentMark = Number(
          markPrice || currentPos?.mark_price || currentPos?.average_open_price,
        );
        const activationError =
          activationNumber !== undefined &&
          (!Number.isFinite(activationNumber) || activationNumber <= 0)
            ? "Please enter a valid activation price."
            : activationNumber !== undefined && currentMark > 0 && side
              ? side === OrderSide.BUY && activationNumber <= currentMark
                ? "For a long position, activation price must be above mark price."
                : side === OrderSide.SELL && activationNumber >= currentMark
                  ? "For a short position, activation price must be below mark price."
                  : undefined
              : activationPriceError(activatedPrice, currentPos, currentMark);
        if (normalizedRate === undefined || !side || activationError) {
          toast.error(
            activationError ||
              "Check the TSL rate before submitting the order.",
          );
          return;
        }

        armedParamsRef.current = {
          callbackRate: normalizedRate,
          activatedPrice: activatedPrice ? Number(activatedPrice) : undefined,
          closePercent: selectedPercent,
          side,
          initialPositionQty: currentSignedQty,
          expiresAt: Date.now() + 120_000,
          fillSeen: false,
        };
        isArmedRef.current = true;
      }
    };

    document.addEventListener("click", handleOrderSubmitClick, true);
    return () => {
      document.removeEventListener("click", handleOrderSubmitClick, true);
    };
  }, [
    activatedPrice,
    callbackRate,
    currentPos,
    currentSignedQty,
    isLimitOrMarket,
    markPrice,
    selectedPercent,
    tslEnabled,
  ]);

  // Arm only becomes executable after Orderly reports an actual fill. A click
  // alone is insufficient because the order can be rejected or cancelled in a
  // confirmation dialog.
  useEffect(() => {
    const handleOrderChange = (event: unknown) => {
      const order = event as {
        symbol?: string;
        side?: OrderSide;
        status?: OrderStatus | string;
      };
      const armed = armedParamsRef.current;
      if (!armed || !isArmedRef.current) return;
      if (Date.now() > armed.expiresAt) {
        armedParamsRef.current = null;
        isArmedRef.current = false;
        return;
      }
      if (
        order.symbol === symbol &&
        order.side === armed.side &&
        (order.status === OrderStatus.FILLED ||
          order.status === OrderStatus.PARTIAL_FILLED)
      ) {
        armed.fillSeen = true;
        setFillRevision((value) => value + 1);
      }
    };

    ee.on("orders:changed", handleOrderChange);
    return () => {
      ee.off("orders:changed", handleOrderChange);
    };
  }, [ee, symbol]);

  // Watch for position updates and automatically attach TSL when armed
  useEffect(() => {
    const armed = armedParamsRef.current;
    if (!armed || !isArmedRef.current || !armed.fillSeen) return;
    if (Date.now() > armed.expiresAt) {
      armedParamsRef.current = null;
      isArmedRef.current = false;
      return;
    }

    const exposureIncreased =
      (armed.side === OrderSide.BUY &&
        currentSignedQty > 0 &&
        currentSignedQty > armed.initialPositionQty) ||
      (armed.side === OrderSide.SELL &&
        currentSignedQty < 0 &&
        currentSignedQty < armed.initialPositionQty);

    if (currentPos && currentPosQty > 0 && exposureIncreased) {
      const {
        callbackRate: rate,
        activatedPrice: actPrice,
        closePercent,
      } = armed;

      const targetQty = floorToTick(
        currentPosQty * (closePercent / 100),
        symbolInfo?.base_tick || 0.00000001,
        symbolInfo?.base_dp ?? 8,
      );
      if (targetQty > 0) {
        // Disarm to prevent duplicate submissions
        isArmedRef.current = false;

        void submitTSL({
          callbackRate: rate,
          quantity: targetQty,
          activatedPrice: actPrice,
        })
          .then((success) => {
            if (success) {
              setTslEnabled(false);
            }
          })
          .catch((error: unknown) => {
            toast.error(getErrorMessage(error, "Failed to attach TSL."));
          });
      }
    }
  }, [
    currentPos,
    currentPosQty,
    currentSignedQty,
    fillRevision,
    submitTSL,
    symbolInfo?.base_dp,
    symbolInfo?.base_tick,
  ]);

  // Inject into DOM beside/under Order Entry TP/SL only when order type is LIMIT or MARKET
  useEffect(() => {
    if (typeof document === "undefined") return;

    const cleanupHost = () => {
      const existingHost = document.getElementById("order-entry-tsl-host");
      if (existingHost) {
        existingHost.remove();
      }
      setPortalTarget(null);
    };

    const attachPortal = () => {
      const allowed = isLimitOrMarket();
      const tpslContainer = document.querySelector(".oui-orderEntry-tpsl");

      // If not Limit or Market, or if native TP/SL container is not present, clean up host and hide
      if (!allowed || !tpslContainer || !tpslContainer.parentElement) {
        cleanupHost();
        setTslEnabled(false);
        isArmedRef.current = false;
        return;
      }

      let host = document.getElementById("order-entry-tsl-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "order-entry-tsl-host";
        host.className = "oui-w-full";
      }

      // Ensure host is placed immediately after .oui-orderEntry-tpsl
      if (
        tpslContainer.parentElement &&
        host.previousElementSibling !== tpslContainer
      ) {
        tpslContainer.parentElement.insertBefore(
          host,
          tpslContainer.nextSibling,
        );
      }

      setPortalTarget(host);
    };

    attachPortal();
    const observer = new MutationObserver(attachPortal);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "class"],
    });

    return () => {
      observer.disconnect();
      cleanupHost();
    };
  }, [isLimitOrMarket]);

  if (!portalTarget) return null;

  return createPortal(
    <div className="oui-orderEntry-tpsl oui-w-full">
      {/* TSL Switch Header */}
      <Flex
        itemAlign="center"
        justify="between"
        className="oui-orderEntry-tpsl-header"
      >
        <Flex itemAlign="center" gapX={1}>
          <Switch
            id="order_entry_tsl_switch"
            className="oui-h-[14px]"
            checked={tslEnabled}
            onCheckedChange={setTslEnabled}
          />
          <label
            htmlFor="order_entry_tsl_switch"
            className="oui-text-xs oui-cursor-pointer select-none"
          >
            TSL
          </label>
        </Flex>
      </Flex>

      {/* Native OrderEntry TSL Input Rows */}
      {tslEnabled && (
        <div className="oui-orderEntry-tpsl-body oui-overflow-hidden oui-transition-all oui-max-h-[120px]">
          <div className="oui-orderEntry-tpsl-form oui-space-y-1 oui-px-px oui-py-2 oui-transition-all">
            {/* Row 1: Trailing Distance % & Activation Price */}
            <Grid cols={2} gapX={1}>
              <Input
                size="md"
                type="number"
                step="0.1"
                min="0.1"
                max="5.0"
                prefix="Trailing"
                placeholder="%"
                align="right"
                autoComplete="off"
                value={callbackRate}
                onValueChange={setCallbackRate}
                onKeyDown={(e) => {
                  const num = Number(callbackRate) || 1.0;
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const next = Math.min(5.0, Number((num + 0.1).toFixed(1)));
                    setCallbackRate(next.toFixed(1));
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const next = Math.max(0.1, Number((num - 0.1).toFixed(1)));
                    setCallbackRate(next.toFixed(1));
                  }
                }}
                classNames={{
                  additional: "oui-text-base-contrast-54",
                  root: "oui-orderEntry-tpsl-triggerPrice oui-pe-2 md:oui-pe-3",
                  prefix:
                    "oui-pe-1 md:oui-pe-2 oui-text-2xs oui-text-base-contrast-54",
                  input: "oui-text-2xs placeholder:oui-text-2xs",
                }}
              />
              <Input
                size="md"
                prefix="Trigger"
                placeholder={quoteToken}
                align="right"
                autoComplete="off"
                value={activatedPrice}
                onValueChange={setActivatedPrice}
                classNames={{
                  additional: "oui-text-base-contrast-54",
                  root: "oui-orderEntry-tpsl-triggerPrice oui-pe-2 md:oui-pe-3",
                  prefix:
                    "oui-pe-1 md:oui-pe-2 oui-text-2xs oui-text-base-contrast-54",
                  input: "oui-text-2xs placeholder:oui-text-2xs",
                }}
              />
            </Grid>

            {/* Row 2: Close Quantity % & Quick Selector */}
            <Grid cols={2} gapX={1}>
              <Input
                size="md"
                prefix="Quantity"
                placeholder="%"
                align="right"
                autoComplete="off"
                value={
                  selectedPercent === 100 ? "100" : selectedPercent.toString()
                }
                onValueChange={(val) => {
                  const num = Number(val);
                  if (!isNaN(num) && num > 0 && num <= 100) {
                    setSelectedPercent(num);
                  } else if (val === "") {
                    setSelectedPercent(100);
                  }
                }}
                classNames={{
                  additional: "oui-text-base-contrast-54",
                  root: "oui-orderEntry-tpsl-triggerPrice oui-pe-2 md:oui-pe-3",
                  prefix:
                    "oui-pe-1 md:oui-pe-2 oui-text-2xs oui-text-base-contrast-54",
                  input: "oui-text-2xs placeholder:oui-text-2xs",
                }}
              />
              <div className="oui-flex oui-items-center oui-gap-1">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setSelectedPercent(pct)}
                    className={cn(
                      "oui-flex-1 oui-h-7 oui-rounded oui-text-3xs oui-font-medium oui-transition-colors",
                      selectedPercent === pct
                        ? "oui-bg-line-12 oui-text-base-contrast"
                        : "oui-bg-line-4 oui-text-base-contrast-36 hover:oui-text-base-contrast-54",
                    )}
                  >
                    {pct === 100 ? "100%" : `${pct}%`}
                  </button>
                ))}
              </div>
            </Grid>
          </div>
        </div>
      )}
    </div>,
    portalTarget,
  );
};
