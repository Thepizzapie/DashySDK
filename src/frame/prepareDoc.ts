/**
 * Wraps generated dashboard HTML in a complete, self-contained iframe document:
 * - Full HTML docs with text/babel → strips AI's partial destructuring, re-wraps
 *   with complete CDN globals + DASHY bootstrap + useDashyData hook
 * - Full HTML docs without babel (infographic/diagram) → injects bootstrap if missing
 * - Bare component snippets → wraps in full CDN template
 */

const DASHY_BOOTSTRAP = [
  "<script>",
  "window.__DASHY__={};window.__DASHY_LISTENERS__=[];",
  "window.__DASHY_SUBSCRIBE__=function(fn){window.__DASHY_LISTENERS__.push(fn);};",
  "window.__DASHY_UPDATE__=function(d){Object.assign(window.__DASHY__,d);window.__DASHY_LISTENERS__.forEach(function(fn){fn(window.__DASHY__);});};",
  "window.addEventListener('message',function(e){if(e.data&&e.data.type==='DASHY_UPDATE')window.__DASHY_UPDATE__(e.data.data);});",
  "</script>",
].join("\n");

/**
 * Fix common AI-generated JSX syntax errors before Babel sees them:
 * - Unterminated string attributes: foo="bar\n  nextProp  →  foo="bar"\n  nextProp
 * - Unterminated string at end of file: foo="bar  →  foo="bar"
 */
function stripUseDashyData(code: string): string {
  const marker = "function useDashyData(";
  let result = code;
  let idx: number;
  while ((idx = result.indexOf(marker)) !== -1) {
    const openBrace = result.indexOf("{", idx);
    if (openBrace === -1) break;
    let depth = 0, i = openBrace;
    for (; i < result.length; i++) {
      if (result[i] === "{") depth++;
      else if (result[i] === "}") { if (--depth === 0) break; }
    }
    result = result.slice(0, idx) + result.slice(i + 1);
  }
  return result;
}

function fixJsxSyntax(code: string): string {
  // Unterminated JSX string attribute followed by newline + next attribute/tag
  code = code.replace(/=("(?:[^"\\\n]|\\.)*)\n(\s+[a-zA-Z/])/g, '=$1"\n$2');
  // Unterminated string at end of code
  code = code.replace(/=("(?:[^"\\\n]|\\.)*)$/gm, '=$1"');
  // Remove empty self-closing Recharts children with no dataKey — they cause "Invariant failed"
  // e.g. <Line /> or <Bar /> inside a chart with no props
  code = code.replace(/<(Line|Bar|Area|Scatter)\s*\/>/g, '{/* removed empty $1 */}');
  return code;
}

export function prepareDoc(html: string): string {
  if (!html) return "";

  const isFullDoc = /^\s*<!DOCTYPE\s+html|^\s*<html/i.test(html);

  // Full HTML doc with text/babel → extract component, re-wrap with complete globals
  if (isFullDoc && /type=["']text\/babel["']/i.test(html)) {
    const m = html.match(/<script[^>]*type=["']text\/babel["'][^>]*>([\s\S]*?)<\/script>/i);
    if (m) {
      let code = m[1]
        .replace(/const\s*\{[^{}]*\}\s*=\s*React\s*;/gs, "")
        .replace(/const\s*\{[^{}]*\}\s*=\s*Recharts\s*;/gs, "")
        .replace(/const\s*\{[^{}]*\}\s*=\s*MaterialUI\s*;/gs, "")
        .replace(/const\s+root\s*=\s*ReactDOM\.createRoot[\s\S]*?root\.render[\s\S]*?;/g, "")
        .replace(/ReactDOM\.createRoot[\s\S]*?\.render[\s\S]*?;/g, "")
        .replace(/^export\s+default\s+/m, "const __DefaultExport = ");
      return buildTemplate(fixJsxSyntax(stripUseDashyData(code)));
    }
  }

  // Full HTML doc (infographic/diagram/already complete) — inject bootstrap if missing
  if (isFullDoc) {
    if (!html.includes("__DASHY__")) {
      return html.replace(/(<head[^>]*>)/i, `$1\n${DASHY_BOOTSTRAP}`);
    }
    return html;
  }

  // Bare snippet — strip ESM imports and wrap
  const code = html
    .replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]\s*;?/gs, "")
    .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/^export\s+default\s+/m, "const __DefaultExport = ");
  return buildTemplate(fixJsxSyntax(stripUseDashyData(code)));
}

function buildTemplate(code: string): string {
  return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
${DASHY_BOOTSTRAP}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Plus Jakarta Sans", -apple-system, sans-serif; background: #0f1117; color: #f0f4ff; overflow-x: hidden; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
</style>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head><body><div id="root"></div>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/prop-types@15/prop-types.min.js"></script>
<script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js"></script>
<script src="https://unpkg.com/@mui/material@5/umd/material-ui.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script>
(function waitForGlobals() {
  if (!window.React || !window.ReactDOM || !window.Recharts || !window.MaterialUI || !window.Babel) {
    return setTimeout(waitForGlobals, 50);
  }
  window.useDashyData = window.useDashyData || function(sourceName, fallback) {
    var s = React.useState(function() { return window.__DASHY__?.[sourceName] ?? fallback; });
    React.useEffect(function() {
      window.__DASHY_SUBSCRIBE__?.(function(d) { if (d[sourceName] !== undefined) s[1](d[sourceName]); });
    }, [sourceName]);
    return s[0];
  };
  Babel.transformScriptTags();
})();
</script>
<script type="text/babel" data-presets="react" id="__app_babel">
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  ComposedChart, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  RadialBarChart, RadialBar, ScatterChart, Scatter, Treemap, FunnelChart, Funnel,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
  ReferenceLine, ReferenceArea, ReferenceDot, Brush, ZAxis, ErrorBar } = Recharts;
const { Box, Stack, Grid, Typography, Card, CardContent, Chip, LinearProgress,
  Button, ButtonGroup, Tabs, Tab, ToggleButton, ToggleButtonGroup, Paper, Divider,
  Avatar, Alert, AlertTitle, ThemeProvider, createTheme, CssBaseline, IconButton,
  Tooltip: MuiTooltip, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Skeleton, CircularProgress, Badge, Switch, FormControlLabel, Select,
  MenuItem, FormControl, InputLabel, Slider, Rating, Accordion, AccordionSummary,
  AccordionDetails, List, ListItem, ListItemText, ListItemIcon, ListItemButton,
  Drawer, AppBar, Toolbar, Menu, Snackbar, Dialog, DialogTitle, DialogContent,
  DialogActions, CardHeader, CardActions, AvatarGroup, ButtonBase, alpha } = MaterialUI;
${code}
const __exports = typeof __DefaultExport !== 'undefined' ? __DefaultExport
  : typeof Dashboard !== 'undefined' ? Dashboard
  : typeof GeneratedUI !== 'undefined' ? GeneratedUI
  : typeof App !== 'undefined' ? App : null;
if (__exports) ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__exports));
</script></body></html>`;
}
