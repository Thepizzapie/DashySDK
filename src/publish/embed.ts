// Legacy embed code builder — kept for middleware compatibility.
// JWT-based publishing is no longer part of the SDK core.

export function buildEmbedCodes(
  id: string,
  token: string,
  baseUrl: string
): { url: string; iframeCode: string; scriptCode: string } {
  const url = `${baseUrl.replace(/\/$/, "")}/reports/${id}?token=${token}`;

  const iframeCode = `<iframe
  src="${url}"
  width="100%"
  height="600"
  frameborder="0"
  style="border:none;border-radius:8px;"
  allowtransparency="true">
</iframe>`;

  const scriptCode = `<div id="dashy-report-${id}"></div>
<script>
(function() {
  var s = document.createElement('script');
  s.src = '${baseUrl.replace(/\/$/, "")}/embed.js';
  s.onload = function() {
    DashyEmbed.render('${id}', '${token}', { container: 'dashy-report-${id}' });
  };
  document.head.appendChild(s);
})();
</script>`;

  return { url, iframeCode, scriptCode };
}
