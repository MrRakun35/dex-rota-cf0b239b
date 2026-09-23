import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  usePositionStream,
  useSymbolsInfo,
  useMarkPrice,
  useEventEmitter,
} from "@orderly.network/hooks";
import { Switch, Input, Grid, Flex, cn, toast } from "@orderly.network/ui";
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
  const quoteDp = symbolInfo?.quote_dp ?? 2;
  const { data: markPrice } = useMarkPrice(symbol);

  // Position stream to track when position opens or changes
  const [positionsData] = usePositionStream("all");
  const currentPos = positionsData?.rows?.find((p: any) => p.symbol === symbol);
  const currentPosQty = Math.abs(Number(currentPos?.position_qty ?? 0));
  const prevPosQtyRef = useRef<number>(currentPosQty);

  // TSL submission hook
  const { submitTSL } = usePositionTSL(currentPos ?? undefined);
  const ee = useEventEmitter();

  // Armed state: when user submits an order with TSL checked
  const isArmedRef = useRef<boolean>(false);
  const armedParamsRef = useRef<{
    callbackRate: number;
    activatedPrice?: number;
    closePercent: number;
  } | null>(null);

  // Keep armed state updated while TSL is enabled
  useEffect(() => {
    if (tslEnabled) {
      const rateNum = Number(callbackRate);
      if (!isNaN(rateNum) && rateNum >= 0.1 && rateNum <= 5.0) {
        armedParamsRef.current = {
          callbackRate: Number(rateNum.toFixed(1)),
          activatedPrice: activatedPrice ? Number(activatedPrice) : undefined,
          closePercent: selectedPercent,
        };
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
      const submitBtn = target.closest("button");
      if (!submitBtn) return;

      const btnText = (submitBtn.textContent || "").trim();
      const isSubmitBtn =
        btnText.includes("Buy") ||
        btnText.includes("Sell") ||
        btnText.includes("Satın Al") ||
        btnText.includes("Sat") ||
        btnText.includes("Uzun") ||
        btnText.includes("Kısa");

      if (
        isSubmitBtn &&
        tslEnabled &&
        armedParamsRef.current &&
        isLimitOrMarket()
      ) {
        isArmedRef.current = true;
      }
    };

    document.addEventListener("click", handleOrderSubmitClick, true);
    return () => {
      document.removeEventListener("click", handleOrderSubmitClick, true);
    };
  }, [tslEnabled]);

  // Helper to detect if Order Entry is currently on LIMIT or MARKET
  const isLimitOrMarket = useCallback((): boolean => {
    if (typeof document === "undefined") return false;

    // 1. If Orderly's TP/SL container is present in the DOM, it is definitely Limit or Market
    const tpslContainer = document.querySelector(".oui-orderEntry-tpsl");
    if (tpslContainer) return true;

    // 2. Check desktop order type tabs
    const limitBtn = document.querySelector(
      '[data-testid="oui-testid-orderEntry-orderType-limit"]',
    );
    if (limitBtn?.getAttribute("aria-pressed") === "true") return true;

    const marketBtn = document.querySelector(
      '[data-testid="oui-testid-orderEntry-orderType-market"]',
    );
    if (marketBtn?.getAttribute("aria-pressed") === "true") return true;

    // 3. Check mobile order type select
    const mobileBtn = document.querySelector(
      '[data-testid="oui-testid-orderEntry-orderType-button"]',
    );
    if (mobileBtn) {
      const text = (mobileBtn.textContent || "").toLowerCase();
      if (
        (text.includes("limit") ||
          text.includes("market") ||
          text.includes("piyasa")) &&
        !text.includes("stop") &&
        !text.includes("scaled") &&
        !text.includes("trailing")
      ) {
        return true;
      }
    }

    return false;
  }, []);

  // Watch for position updates and automatically attach TSL when armed
  useEffect(() => {
    const prevQty = prevPosQtyRef.current;
    prevPosQtyRef.current = currentPosQty;

    // Detect when position was opened or increased while armed
    if (
      isArmedRef.current &&
      armedParamsRef.current &&
      currentPos &&
      currentPosQty > 0 &&
      (prevQty === 0 || currentPosQty > prevQty)
    ) {
      const {
        callbackRate: rate,
        activatedPrice: actPrice,
        closePercent,
      } = armedParamsRef.current;

      const targetQty = currentPosQty * (closePercent / 100);
      if (targetQty > 0) {
        // Disarm to prevent duplicate submissions
        isArmedRef.current = false;

        submitTSL({
          callbackRate: rate,
          quantity: targetQty,
          activatedPrice: actPrice,
        }).then((success) => {
          if (success) {
            toast.success(
              `Trailing Stop Loss (TSL ${rate}%) attached to position successfully.`,
            );
            // Optionally reset or keep for next order
            setTslEnabled(false);
          }
        });
      }
    }
  }, [currentPosQty, currentPos, submitTSL]);

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
