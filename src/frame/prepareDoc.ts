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
        const cleaned = fixJsxSyntax(stripUseDashyData(code));
      return buildTemplate(cleaned, findRootComponents(cleaned));
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
  const cleaned = fixJsxSyntax(stripUseDashyData(code));
  return buildTemplate(cleaned, findRootComponents(cleaned));
}

/** Scan code for top-level PascalCase function/const declarations — these are React components. */
function findRootComponents(code: string): string[] {
  const names: string[] = [];
  const re = /(?:^|\n)\s*(?:function\s+([A-Z][A-Za-z0-9_]*)\s*\(|const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\(|React\.memo|forwardRef))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1] || m[2];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function buildTemplate(code: string, componentNames: string[] = []): string {
  // Build __exports chain: well-known names first, then any PascalCase names found in code (last defined = most likely root)
  const knownNames = ["__DefaultExport", "Dashboard", "GeneratedUI", "App"];
  // Filter out non-component utility names heuristically (e.g. GlassCard, SleekStat are sub-components, not roots)
  // We use the last PascalCase name found as it's typically the top-level wrapper
  const extraNames = componentNames.filter(n => !knownNames.includes(n));
  const allCandidates = [...knownNames, ...[...extraNames].reverse()];
  const exportsChain = allCandidates
    .map(n => `typeof ${n} !== 'undefined' ? ${n}`)
    .join("\n  : ") + "\n  : null";
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
  try {
    Babel.transformScriptTags();
  } catch(e) {
    document.getElementById('root').innerHTML =
      '<div style="font-family:monospace;padding:32px;color:#f87171;background:#0f1117;min-height:100vh">' +
      '<div style="font-size:13px;font-weight:700;color:#fca5a5;margin-bottom:12px">⚠ Babel compile error</div>' +
      '<pre style="white-space:pre-wrap;font-size:12px;color:#fca5a5;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:16px">' +
      (e.message || String(e)).replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>' +
      '<div style="margin-top:16px;font-size:11px;color:#64748b">The AI generated invalid JSX. Regenerate the dashboard to get a fixed version.</div>' +
      '</div>';
  }
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
  DialogActions, CardHeader, CardActions, AvatarGroup, ButtonBase, alpha,
  TextField, InputAdornment, OutlinedInput, FilledInput, InputBase,
  Autocomplete, Pagination, Stepper, Step, StepLabel, StepContent,
  Fab, BottomNavigation, BottomNavigationAction,
  SpeedDial, SpeedDialAction, SpeedDialIcon } = MaterialUI;
${code}
const __exports = ${exportsChain};
if (__exports) ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__exports));
</script></body></html>`;
}
