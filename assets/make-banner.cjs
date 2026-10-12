// Writes the README banners (assets/banner-dark.svg, assets/banner-light.svg) and the social preview source
// (assets/social-preview.svg; turn it into assets/social-preview.png at 1280x640, for example with a headless
// browser screenshot). Run from the repository root: node assets/make-banner.cjs
// The emblem is the plugin's icon (mcpb/icon.png), beside the name, the motto and what it needs.
const fs = require('fs');

const icon = `data:image/png;base64,${fs.readFileSync('mcpb/icon.png').toString('base64')}`;
const GREEN = '#10A37F';
const ORANGE = '#D97757';

function emblem({ dark }) {
  const text = dark ? '#E6EDF3' : '#1F2328';
  const muted = dark ? '#9198A1' : '#59636E';
  const chip = dark ? '#21262D' : '#F6F8FA';
  const chipLine = dark ? '#3D444D' : '#D1D9E0';
  const chips = ['No API keys', 'Your own subscriptions', 'Read-only in your project', 'Claude Code · Codex · desktop apps'];
  let x = 470;
  let y = 268;
  const chipRow = chips.map(label => {
    const width = 18 + label.length * 7.3;
    if (x + width > 985) { x = 470; y += 38; }
    const svg = `<rect x="${x}" y="${y}" width="${width}" height="28" rx="14" fill="${chip}" stroke="${chipLine}"/>
    <text x="${x + width / 2}" y="${y + 19}" class="chip" fill="${text}" text-anchor="middle">${label}</text>`;
    x += width + 10;
    return svg;
  });
  const style = `
      text { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; }
      .chip { font-size: 13px; }`;
  const body = `
  <image href="${icon}" x="40" y="10" width="360" height="360"/>
  <text x="470" y="118" font-size="30" font-weight="600" fill="${text}">Codex–Claude</text>
  <text x="468" y="190" font-size="76" font-weight="800" letter-spacing="6" fill="url(#brand)">COUNCIL</text>
  <text x="470" y="236" font-size="19" fill="${muted}"><tspan fill="${GREEN}" font-weight="700">ChatGPT</tspan> and <tspan fill="${ORANGE}" font-weight="700">Claude</tspan> discuss with each other until they agree</text>
  ${chipRow.join('\n  ')}`;
  const defs = `<defs>
    <linearGradient id="brand" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${GREEN}"/><stop offset="1" stop-color="${ORANGE}"/></linearGradient>
    <style>${style}
    </style>
  </defs>`;
  return { defs, body };
}

const LABEL = 'Codex–Claude Council: ChatGPT and Claude discuss with each other until they agree';
for (const theme of ['dark', 'light']) {
  const { defs, body } = emblem({ dark: theme === 'dark' });
  fs.writeFileSync(`assets/banner-${theme}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="380" viewBox="0 0 1000 380" role="img" aria-label="${LABEL}">
  ${defs}${body}
</svg>
`);
}

// The social preview (GitHub: Settings > Social preview): 1280x640, the dark banner on its background.
const { defs, body } = emblem({ dark: true });
fs.writeFileSync('assets/social-preview.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-label="${LABEL}">
  ${defs}
  <rect width="1280" height="640" fill="#0D1117"/>
  <rect x="0" y="0" width="1280" height="6" fill="url(#brand)"/>
  <g transform="translate(140,110)">${body}
  </g>
  <text x="640" y="575" text-anchor="middle" font-size="22" fill="#9198A1" font-family="ui-monospace, 'Cascadia Mono', Consolas, monospace">npx -y codex-claude-council install</text>
</svg>
`);
