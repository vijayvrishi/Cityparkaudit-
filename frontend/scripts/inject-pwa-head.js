// expo-router's app/+html.tsx customization only applies to "static"/"server"
// web output, not the "single" (SPA) output this app uses - so PWA tags are
// injected into dist/index.html here, after `expo export --platform web`.
const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "dist", "index.html");
let html = fs.readFileSync(indexPath, "utf8");

const tags = `
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
<link rel="icon" href="/icon-512.png" sizes="512x512" type="image/png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="CityPark Audit" />
<meta name="description" content="Hotel audit checklists, action items, and analytics for City Park Hotel." />
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
</script>
`.trim();

if (!html.includes('rel="manifest"')) {
  html = html.replace("</head>", `${tags}\n</head>`);
  fs.writeFileSync(indexPath, html);
  console.log("Injected PWA tags into dist/index.html");
} else {
  console.log("PWA tags already present in dist/index.html, skipping");
}
