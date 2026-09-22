import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  usePositionStream,
  useOrderStream,
  useAccount,
} from "@orderly.network/hooks";
import { API, AlgoOrderRootType, OrderStatus } from "@orderly.network/types";
import { cn, Text } from "@orderly.network/ui";
import { TSLDialog } from "./TSLDialog";

interface TSLPortalTarget {
  id: string;
  element: HTMLElement;
  position: API.PositionTPSLExt | API.PositionExt;
  activeOrder?: any;
}

export const TSLTableEnhancer: React.FC = () => {
  const { account } = useAccount();
  const [positionsData] = usePositionStream("all");
  const positions = positionsData?.rows || [];

  const [selectedPosition, setSelectedPosition] = useState<
    API.PositionTPSLExt | API.PositionExt | null
  >(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialRate, setInitialRate] = useState<string | undefined>(undefined);

  // Active incomplete algo orders (live subscription)
  const [algoOrders, { refresh: refreshAlgoOrders }] = useOrderStream(
    {
      status: OrderStatus.INCOMPLETE,
      includes: [AlgoOrderRootType.TRAILING_STOP],
    },
    { keeplive: true },
  );

  const [desktopPortals, setDesktopPortals] = useState<TSLPortalTarget[]>([]);
  const [mobilePortals, setMobilePortals] = useState<TSLPortalTarget[]>([]);

  const handleOpenDialog = useCallback(
    (pos: API.PositionTPSLExt | API.PositionExt) => {
      setSelectedPosition(pos);
      setInitialRate(undefined);
      setDialogOpen(true);
    },
    [],
  );

  // Listen for open-tsl-dialog events (e.g. from chart drag & drop)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOpenTSLEvent = (e: any) => {
      const { position, initialCallbackRate } = e.detail || {};
      if (position) {
        setSelectedPosition(position);
      }
      setInitialRate(initialCallbackRate || undefined);
      setDialogOpen(true);
    };

    window.addEventListener("open-tsl-dialog", handleOpenTSLEvent);
    return () => {
      window.removeEventListener("open-tsl-dialog", handleOpenTSLEvent);
    };
  }, []);

  // Update DOM when positions or algoOrders change
  useEffect(() => {
    if (typeof document === "undefined") return;

    const enhanceDesktopTable = () => {
      const container = document.getElementById(
        "oui-desktop-positions-content",
      );
      if (!container) return;

      const table = container.querySelector("table");
      if (!table) return;

      const thead = table.querySelector("thead");
      const tbody = table.querySelector("tbody");
      if (!thead || !tbody) return;

      const headerRow = thead.querySelector("tr");
      if (!headerRow) return;

      // 1. Ensure Header Column exists
      let tslTh = headerRow.querySelector(
        'th[data-index="tsl"]',
      ) as HTMLTableCellElement | null;
      let notionalTh: HTMLTableCellElement | null = null;
      let targetIndex = -1;

      const ths = Array.from(headerRow.children) as HTMLTableCellElement[];

      // Find "Nominal" or "Notional" column to insert immediately before it
      for (let i = 0; i < ths.length; i++) {
        if (ths[i].getAttribute("data-index") === "tsl") continue;
        const text = (ths[i].textContent || "").trim();
        if (
          text.includes("Nominal") ||
          text.includes("Notional") ||
          ths[i].getAttribute("data-index") === "notional"
        ) {
          notionalTh = ths[i];
          targetIndex = i;
          break;
        }
      }

      // Fallback: search for Partial TP/SL / Kısmi TP/SL and place right after
      if (!notionalTh) {
        for (let i = 0; i < ths.length; i++) {
          if (ths[i].getAttribute("data-index") === "tsl") continue;
          const text = (ths[i].textContent || "").trim();
          if (
            text.includes("Kısmi") ||
            text.includes("Partial") ||
            ths[i].getAttribute("data-index") === "partial_tpsl"
          ) {
            targetIndex = i + 1;
            notionalTh = ths[i + 1] || null;
            break;
          }
        }
      }

      if (!tslTh) {
        tslTh = document.createElement("th");
        tslTh.setAttribute("data-index", "tsl");
        tslTh.className = notionalTh
          ? notionalTh.className
          : "oui-table-thead-th oui-relative oui-h-9 oui-text-2xs oui-font-semibold oui-text-base-contrast-54 oui-px-1";
        tslTh.style.width = "100px";
        tslTh.style.minWidth = "80px";
        tslTh.innerHTML = `<div class="oui-flex oui-items-center"><span>TSL</span></div>`;

        if (notionalTh) {
          headerRow.insertBefore(tslTh, notionalTh);
        } else if (targetIndex !== -1 && targetIndex < ths.length) {
          headerRow.insertBefore(tslTh, ths[targetIndex]);
        } else {
          headerRow.appendChild(tslTh);
        }
      } else if (notionalTh && tslTh.nextElementSibling !== notionalTh) {
        // Ensure it stays right before notional if re-rendered
        headerRow.insertBefore(tslTh, notionalTh);
      }

      // Re-calculate targetIndex after potential th insertion
      const updatedThs = Array.from(
        headerRow.children,
      ) as HTMLTableCellElement[];
      const colIndex = updatedThs.findIndex(
        (th) => th.getAttribute("data-index") === "tsl",
      );

      // 2. Ensure each tbody tr has matching td
      const bodyRows = Array.from(
        tbody.querySelectorAll("tr.oui-table-tbody-tr"),
      ) as HTMLTableRowElement[];
      const newPortals: TSLPortalTarget[] = [];

      bodyRows.forEach((row, idx) => {
        // Match position by symbol or row index
        const rowText = row.textContent || "";
        let matchingPos = positions.find(
          (p) =>
            p.symbol &&
            rowText.includes(
              p.symbol.replace("PERP_", "").replace("_USDC", ""),
            ),
        );
        if (!matchingPos && positions[idx]) {
          matchingPos = positions[idx];
        }

        if (!matchingPos) return;

        let tslTd = row.querySelector(
          'td[data-index="tsl"]',
        ) as HTMLTableCellElement | null;
        if (!tslTd) {
          tslTd = document.createElement("td");
          tslTd.setAttribute("data-index", "tsl");
          const siblingTd = row.querySelector(
            "td.oui-table-tbody-td",
          ) as HTMLTableCellElement | null;
          tslTd.className = siblingTd
            ? siblingTd.className
            : "oui-table-tbody-td oui-relative oui-px-1";
          tslTd.style.width = "100px";
          tslTd.style.minWidth = "80px";

          // Hover background div matching Orderly's CellHover
          const hoverDiv = document.createElement("div");
          hoverDiv.className =
            "oui-absolute oui-start-0 oui-top-0 oui-z-[-1] oui-size-full group-hover:oui-bg-line-4";
          tslTd.appendChild(hoverDiv);

          // Content wrapper div
          const contentDiv = document.createElement("div");
          contentDiv.className = "oui-flex oui-items-center oui-h-full";
          tslTd.appendChild(contentDiv);

          const tds = Array.from(row.children);
          if (colIndex !== -1 && colIndex < tds.length) {
            row.insertBefore(tslTd, tds[colIndex]);
          } else {
            row.appendChild(tslTd);
          }
        } else {
          const currentIdx = Array.from(row.children).indexOf(tslTd);
          if (
            colIndex !== -1 &&
            currentIdx !== colIndex &&
            row.children[colIndex]
          ) {
            row.insertBefore(tslTd, row.children[colIndex]);
          }
        }

        const targetElement = (tslTd.querySelector(
          ".oui-flex.oui-items-center",
        ) || tslTd) as HTMLElement;

        const activeOrder = algoOrders?.find(
          (o: any) =>
            o.symbol === matchingPos?.symbol &&
            (o.algo_type === "TRAILING_STOP" ||
              o.algo_type === AlgoOrderRootType.TRAILING_STOP),
        );

        newPortals.push({
          id: `desktop-${matchingPos.symbol}-${matchingPos.margin_mode ?? "cross"}-${idx}`,
          element: targetElement,
          position: matchingPos,
          activeOrder,
        });
      });

      setDesktopPortals(newPortals);
    };

    const enhanceMobileCards = () => {
      const mobileContainer = document.querySelector(
        ".oui-hide-scrollbar.oui-w-full",
      );
      if (!mobileContainer) return;

      const cards = Array.from(mobileContainer.children) as HTMLElement[];
      const newMobilePortals: TSLPortalTarget[] = [];

      cards.forEach((card, idx) => {
        const cardText = card.textContent || "";
        let matchingPos = positions.find(
          (p) =>
            p.symbol &&
            cardText.includes(
              p.symbol.replace("PERP_", "").replace("_USDC", ""),
            ),
        );
        if (!matchingPos && positions[idx]) {
          matchingPos = positions[idx];
        }
        if (!matchingPos) return;

        let tslMobileDiv = card.querySelector(
          '[data-tsl-mobile="true"]',
        ) as HTMLElement | null;
        if (!tslMobileDiv) {
          tslMobileDiv = document.createElement("div");
          tslMobileDiv.setAttribute("data-tsl-mobile", "true");
          tslMobileDiv.className =
            "oui-flex oui-justify-between oui-items-center oui-text-2xs oui-pt-1.5 oui-mt-1.5 oui-border-t oui-border-line-4";

          // Find the TP/SL grid or container in card
          const grid = card.querySelector(".oui-grid");
          if (grid && grid.parentNode) {
            grid.parentNode.insertBefore(tslMobileDiv, grid.nextSibling);
          } else {
            card.appendChild(tslMobileDiv);
          }
        }

        const activeOrder = algoOrders?.find(
          (o: any) =>
            o.symbol === matchingPos?.symbol &&
            (o.algo_type === "TRAILING_STOP" ||
              o.algo_type === AlgoOrderRootType.TRAILING_STOP),
        );

        newMobilePortals.push({
          id: `mobile-${matchingPos.symbol}-${matchingPos.margin_mode ?? "cross"}-${idx}`,
          element: tslMobileDiv,
          position: matchingPos,
          activeOrder,
        });
      });

      setMobilePortals(newMobilePortals);
    };

    enhanceDesktopTable();
    enhanceMobileCards();

    // Observe DOM mutations inside trading data list
    const observer = new MutationObserver(() => {
      enhanceDesktopTable();
      enhanceMobileCards();
    });

    const targetNode =
      document.getElementById("oui-desktop-positions-content") || document.body;
    observer.observe(targetNode, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [positions, algoOrders]);

  return (
    <>
      {/* Desktop Portals */}
      {desktopPortals.map((target) =>
        createPortal(
          <TSLCellRenderer
            position={target.position}
            activeOrder={target.activeOrder}
            onOpen={() => handleOpenDialog(target.position)}
          />,
          target.element,
          target.id,
        ),
      )}

      {/* Mobile Portals */}
      {mobilePortals.map((target) =>
        createPortal(
          <TSLMobileRenderer
            position={target.position}
            activeOrder={target.activeOrder}
            onOpen={() => handleOpenDialog(target.position)}
          />,
          target.element,
          target.id,
        ),
      )}

      {/* Trailing Stop Loss Dialog */}
      <TSLDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setInitialRate(undefined);
        }}
        position={selectedPosition}
        initialCallbackRate={initialRate}
        onSuccess={() => {
          refreshAlgoOrders?.();
        }}
      />
    </>
  );
};

interface TSLCellRendererProps {
  position: API.PositionTPSLExt | API.PositionExt;
  activeOrder?: any;
  onOpen: () => void;
}

const TSLCellRenderer: React.FC<TSLCellRendererProps> = ({
  activeOrder,
  onOpen,
}) => {
  if (activeOrder) {
    const ratePercent = activeOrder.callback_rate
      ? (Number(activeOrder.callback_rate) * 100).toFixed(1)
      : null;
    const valueDistance = activeOrder.callback_value
      ? Number(activeOrder.callback_value)
      : null;

    return (
      <div className="oui-flex oui-items-center oui-gap-1">
        <Text
          onClick={onOpen}
          className="oui-cursor-pointer oui-text-warning hover:oui-underline"
          title="Click to edit Trailing Stop Loss"
        >
          {ratePercent ? `${ratePercent}%` : `$${valueDistance}`}
        </Text>
        <button
          type="button"
          onClick={onOpen}
          className="oui-text-warning/70 hover:oui-text-warning oui-p-0.5"
          title="Edit TSL"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="oui-flex oui-items-center">
      <Text
        className="oui-cursor-pointer oui-text-base-contrast hover:oui-text-primary"
        onClick={onOpen}
      >
        Add
      </Text>
    </div>
  );
};

const TSLMobileRenderer: React.FC<TSLCellRendererProps> = ({
  activeOrder,
  onOpen,
}) => {
  const ratePercent = activeOrder?.callback_rate
    ? (Number(activeOrder.callback_rate) * 100).toFixed(1)
    : null;

  return (
    <div className="oui-flex oui-items-center oui-justify-between oui-w-full">
      <span className="oui-text-base-contrast-54">TSL:</span>
      {activeOrder ? (
        <Text
          onClick={onOpen}
          className="oui-cursor-pointer oui-text-warning hover:oui-underline"
        >
          {ratePercent ? `${ratePercent}%` : "Active"} ✎
        </Text>
      ) : (
        <Text
          onClick={onOpen}
          className="oui-cursor-pointer oui-text-base-contrast hover:oui-text-primary"
        >
          Add
        </Text>
      )}
    </div>
  );
};
