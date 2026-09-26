import { useCallback, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { TradingPage } from "@orderly.network/trading";
import { API } from "@orderly.network/types";
import { OrderEntryTSLEnhancer } from "@/components/tsl/OrderEntryTSLEnhancer";
import { TSLTableEnhancer } from "@/components/tsl/TSLTableEnhancer";
import { useTSLChartLine } from "@/components/tsl/useTSLChartLine";
import { useOrderlyConfig } from "@/utils/config";
import { getPageMeta } from "@/utils/seo";
import { renderSEOTags } from "@/utils/seo-tags";
import { updateSymbol } from "@/utils/storage";
import { formatSymbol, generatePageTitle } from "@/utils/utils";

const chartOverlayMigrationKey = "rota:tradingview-overlays:v2";
const chartDisplaySettingKey = "TradingviewSDK.displaySetting";

function enableNativeChartOverlays() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(chartOverlayMigrationKey)) return;

  try {
    const stored = localStorage.getItem(chartDisplaySettingKey);
    const current = stored
      ? (JSON.parse(stored) as Record<string, unknown>)
      : {};
    localStorage.setItem(
      chartDisplaySettingKey,
      JSON.stringify({
        ...current,
        position: true,
        buySell: true,
        limitOrders: true,
        stopOrders: true,
        tpsl: true,
        positionTpsl: true,
        trailingStop: true,
        liquidationPrice: true,
      }),
    );
    localStorage.setItem(chartOverlayMigrationKey, "1");
  } catch {
    // A malformed legacy value should not prevent the trading page rendering.
    localStorage.removeItem(chartDisplaySettingKey);
  }
}

export default function PerpSymbol() {
  const params = useParams();
  enableNativeChartOverlays();
  const symbol = params.symbol!;
  const config = useOrderlyConfig();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useTSLChartLine(symbol);

  useEffect(() => {
    updateSymbol(symbol);
  }, [symbol]);

  const onSymbolChange = useCallback(
    (data: API.Symbol) => {
      const nextSymbol = data.symbol;
      if (nextSymbol === symbol) return;

      const searchParamsString = searchParams.toString();
      const queryString = searchParamsString ? `?${searchParamsString}` : "";

      navigate(`/perp/${nextSymbol}${queryString}`);
    },
    [navigate, searchParams, symbol],
  );

  const pageMeta = getPageMeta();
  const pageTitle = generatePageTitle(formatSymbol(params.symbol!));

  return (
    <div className="h-full">
      {renderSEOTags(pageMeta, pageTitle)}
      <TradingPage
        symbol={symbol}
        onSymbolChange={onSymbolChange}
        tradingViewConfig={config.tradingPage.tradingViewConfig}
        sharePnLConfig={config.tradingPage.sharePnLConfig}
      />
      <TSLTableEnhancer />
      <OrderEntryTSLEnhancer symbol={symbol} />
      <div className="md:hidden pb-2 pt-8 text-center">
        <span className="oui-text-2xs oui-text-base-contrast-54">
          Charts powered by{" "}
          <a
            href="https://tradingview.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            TradingView
          </a>
        </span>
      </div>
    </div>
  );
}
