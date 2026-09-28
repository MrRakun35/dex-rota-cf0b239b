/* eslint-disable react/prop-types -- interceptor props are supplied by the typed Orderly host */
import * as React from "react";
import type { OrderlyPlugin } from "@orderly.network/plugin-core";
import { BotPanel } from "./BotPanel";

const BOT_TAB_ID = "rota-bots";
const STYLE_ID = "rota-bots-tab-order";

type DataListItem = {
  id?: string;
  title?: React.ReactNode;
  content?: React.ReactNode;
};
type DataListProps = {
  items?: DataListItem[];
  symbol?: string;
  [key: string]: unknown;
};

function DataListWithBots({
  Original,
  props,
}: {
  Original: React.ComponentType<DataListProps>;
  props: DataListProps;
}) {
  const hostItems = React.useMemo(
    () => (Array.isArray(props.items) ? props.items : []),
    [props.items],
  );
  const symbol = props?.symbol as string | undefined;
  const panel = React.useMemo(() => <BotPanel symbol={symbol} />, [symbol]);
  const botItem = React.useMemo(
    () => ({ id: BOT_TAB_ID, title: "Bots", content: panel }),
    [panel],
  );
  const items = React.useMemo(
    () =>
      hostItems.some((item) => item?.id === BOT_TAB_ID)
        ? hostItems
        : [...hostItems, botItem],
    [hostItems, botItem],
  );
  React.useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `[id$="-trigger-${BOT_TAB_ID}"]{order:9999}`;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  return <Original {...props} items={items} />;
}

export function registerRotaBots(): OrderlyPlugin {
  return {
    id: "rota-bots",
    name: "Rota Bots",
    version: "1.0.0",
    orderlyVersion: ">=3.2.0",
    interceptors: [
      {
        target: "Trading.DataList.Desktop.Tabs",
        component: (Original, props) => (
          <DataListWithBots Original={Original} props={props} />
        ),
      },
      {
        target: "Trading.DataList.Mobile.Tabs",
        component: (Original, props) => (
          <DataListWithBots Original={Original} props={props} />
        ),
      },
    ],
  };
}
