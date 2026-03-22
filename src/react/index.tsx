import * as React from "react";

export interface ReportFrameProps {
  /** JWT token returned by publisher.publish() */
  token: string;
  /** Base URL where the report middleware is mounted */
  baseUrl: string;
  /** Report ID */
  reportId: string;
  /** iframe width (default: "100%") */
  width?: string | number;
  /** iframe height (default: 600) */
  height?: string | number;
  /** Extra className on the wrapper div */
  className?: string;
  /** Extra style on the wrapper div */
  style?: React.CSSProperties;
  /** Called when the iframe finishes loading */
  onLoad?: () => void;
  /** Called on load error */
  onError?: (err: Error) => void;
}

/**
 * Drop-in React component for embedding a published report.
 *
 * @example
 * <ReportFrame
 *   reportId={published.id}
 *   token={published.token}
 *   baseUrl="https://yourapp.com"
 *   height={500}
 * />
 */
export function ReportFrame({
  token,
  baseUrl,
  reportId,
  width = "100%",
  height = 600,
  className,
  style,
  onLoad,
  onError,
}: ReportFrameProps) {
  const src = `${baseUrl.replace(/\/$/, "")}/reports/${reportId}?token=${encodeURIComponent(token)}`;
  const [loaded, setLoaded] = React.useState(false);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width,
        height,
        ...style,
      }}
    >
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.04)",
            borderRadius: 8,
          }}
        >
          <span style={{ color: "#6b7280", fontSize: 14 }}>Loading report…</span>
        </div>
      )}
      <iframe
        src={src}
        width="100%"
        height="100%"
        frameBorder={0}
        style={{ border: "none", borderRadius: 8, display: loaded ? "block" : "none" }}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        onError={() => onError?.(new Error(`Failed to load report ${reportId}`))}
        title={`Report ${reportId}`}
        sandbox="allow-scripts"
      />
    </div>
  );
}

export type { ReportFrameProps as default };
