import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function GAPageView() {
  const location = useLocation();

  useEffect(() => {
    if (!window.gtag) return;

    const page_path = location.pathname + location.search;

    window.gtag("event", "page_view", {
      page_path,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location]);

  return null;
}