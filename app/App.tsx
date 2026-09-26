import { useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Outlet, useLocation } from "react-router-dom";
import { HttpsRequiredWarning } from "@/components/HttpsRequiredWarning";
import OrderlyProvider from "@/components/orderlyProvider";
import { withBasePath } from "./utils/base-path";
import { getSEOConfig, getUserLanguage } from "./utils/seo";

export default function App() {
  const seoConfig = getSEOConfig();
  const defaultLanguage = getUserLanguage();
  const location = useLocation();
  const isInitialLoad = useRef(true);
  const routeSection =
    location.pathname.split("/").filter(Boolean)[0] || "root";

  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }
    if (typeof window.gtag === "function") {
      window.gtag("event", "page_view", {
        page_path: location.pathname + location.search,
        page_location: window.location.href,
        page_title: document.title,
      });
    }
  }, [location.pathname, location.search]);

  return (
    <>
      <Helmet>
        <html lang={seoConfig.language || defaultLanguage} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="icon"
          type="image/webp"
          href={withBasePath("/favicon.webp")}
        />
      </Helmet>
      <HttpsRequiredWarning />
      <OrderlyProvider>
        <Outlet key={routeSection} />
      </OrderlyProvider>
    </>
  );
}
