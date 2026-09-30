import { useEffect } from "react";
import { useAccount } from "@orderly.network/hooks";
import type {
  IChartWidgetApi,
  IOrderLineAdapter,
} from "../../../public/tradingview/charting_library/charting_library";
import { BotAPIError, listBots } from "../../services/bots";
import { getActiveTradingChart } from "../../utils/trading-chart";
import { dcaLiveLevels } from "./dca-live-levels";
import type { DCAPreviewLevel } from "./dca-preview";

export function DCALiveLevels({ symbol }: { symbol: string }) {
  const { account } = useAccount();
  const wallet = account.address?.toLowerCase() ?? "";
  useEffect(() => {
    let stopped = false;
    let levels: DCAPreviewLevel[] = [];
    let lines: IOrderLineAdapter[] = [];
    let attached: IChartWidgetApi | null = null;
    let drawn = "";
    const clear = () => {
      for (const line of lines) {
        try {
          line.remove();
        } catch {
          /* Widget disposed. */
        }
      }
      lines = [];
      attached = null;
      drawn = "";
    };
    const draw = () => {
      const chart = getActiveTradingChart();
      const signature = JSON.stringify(levels);
      if (!chart || chart.symbol() !== symbol) {
        clear();
        return;
      }
      if (attached === chart && drawn === signature) return;
      clear();
      try {
        for (const level of levels) {
          const line = chart.createOrderLine();
          lines.push(line);
          line
            .setPrice(level.price)
            .setText(level.label)
            .setQuantity(
              level.quantity?.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              }) ?? "",
            )
            .setEditable(false)
            .setCancellable(false)
            .setExtendLeft(true)
            .setLineStyle(2)
            .setLineColor(level.color)
            .setBodyBorderColor(level.color)
            .setBodyTextColor(level.color)
            .setBodyBackgroundColor("#171923")
            .setQuantityBackgroundColor("#171923")
            .setQuantityBorderColor(level.color)
            .setQuantityTextColor(level.color)
            .setTooltip(level.label);
        }
        attached = chart;
        drawn = signature;
      } catch {
        clear();
      }
    };
    let fetching = false;
    const refresh = async () => {
      if (fetching || stopped) return;
      const token = wallet
        ? localStorage.getItem(`rota-copytrade-session:${wallet}`)
        : null;
      if (!token) {
        levels = [];
        draw();
        return;
      }
      fetching = true;
      try {
        const response = await listBots(wallet, token);
        if (!stopped) {
          levels = response.data
            .filter((bot) => bot.symbol === symbol)
            .flatMap(dcaLiveLevels);
          draw();
        }
      } catch (error) {
        if (!stopped && error instanceof BotAPIError && error.status === 401) {
          levels = [];
          draw();
        }
      } finally {
        fetching = false;
      }
    };
    const onUpdate = () => void refresh();
    window.addEventListener("rota-bots-updated", onUpdate);
    const poll = setInterval(onUpdate, 3000);
    const chartPoll = setInterval(draw, 1000);
    void refresh();
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(chartPoll);
      window.removeEventListener("rota-bots-updated", onUpdate);
      clear();
    };
  }, [symbol, wallet]);
  return null;
}
