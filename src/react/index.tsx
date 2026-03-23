import * as React from "react";
import { prepareDoc } from "../frame/prepareDoc.js";

export interface DashyFrameProps {
  /** Generated dashboard HTML from sdk.generate() / sdk.stream() */
  html: string;
  /**
   * Live data keyed by entity name — sent into the iframe via postMessage.
   * Keys must match the sentinel names in the HTML (e.g. "orders", "products").
   * When this prop changes the iframe re-renders its charts without reloading.
   */
  data?: Record<string, unknown[]>;
  /**
   * Called on a timer to fetch fresh data. Returns the same shape as `data`.
   * Requires `refreshInterval` to be set.
   */
  onRefresh?: () => Promise<Record<string, unknown[]>>;
  /** Auto-refresh interval in ms (requires onRefresh). E.g. 30_000 for 30 s. */
  refreshInterval?: number;
  /** iframe width (default: "100%") */
  width?: string | number;
  /** iframe height (default: 500) */
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
  /** Called when the iframe finishes its initial load */
  onLoad?: () => void;
}

/**
 * Drop-in React component for rendering a generated Dashy dashboard.
 *
 * The iframe is set once from `html` and never reloaded. Live data is pushed
 * in via postMessage, so the dashboard's React state (active tabs, scroll
 * position, filters) is preserved across refreshes.
 *
 * @example
 * // Minimal — static fallback data baked into the HTML
 * <DashyFrame html={dashboard.html_content} height={500} />
 *
 * @example
 * // Live — push fresh data every 30 s without reloading
 * <DashyFrame
 *   html={dashboard.html_content}
 *   data={{ orders: liveOrders }}
 *   onRefresh={async () => ({ orders: await fetchOrders() })}
 *   refreshInterval={30_000}
 * />
 */
export function DashyFrame({
  html,
  data,
  onRefresh,
  refreshInterval,
  width = "100%",
  height = 500,
  className,
  style,
  onLoad,
}: DashyFrameProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // Prepare the doc once — only rebuild if html changes
  const srcDoc = React.useMemo(() => prepareDoc(html), [html]);

  // Push data into iframe whenever the data prop changes
  React.useEffect(() => {
    if (!data) return;
    iframeRef.current?.contentWindow?.postMessage({ type: "DASHY_UPDATE", data }, "*");
  }, [data]);

  // Auto-refresh loop
  React.useEffect(() => {
    if (!onRefresh || !refreshInterval) return;
    const id = setInterval(async () => {
      try {
        const fresh = await onRefresh();
        iframeRef.current?.contentWindow?.postMessage({ type: "DASHY_UPDATE", data: fresh }, "*");
      } catch (e) {
        console.warn("[DashyFrame] refresh failed:", e);
      }
    }, refreshInterval);
    return () => clearInterval(id);
  }, [onRefresh, refreshInterval]);

  return (
    <div
      className={className}
      style={{ width, height, position: "relative", ...style }}
    >
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        style={{ border: "none", width: "100%", height: "100%", display: "block" }}
        title="Dashy Dashboard"
        onLoad={onLoad}
      />
    </div>
  );
}
