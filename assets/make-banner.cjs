// Writes the README banners (assets/banner-dark.svg, assets/banner-light.svg) and the social preview source
// (assets/social-preview.svg; turn it into assets/social-preview.png at 1280x640, for example with a headless
// browser screenshot). Run from the repository root: node assets/make-banner.cjs
// The emblem: both logos, a line from each that crosses the other three times (each crossing an exchange) and
// meets it in one answer. In the README banners the lines draw themselves and the exchanges light up in turn;
// with reduced motion, or in the social preview, everything is shown at once.
const fs = require('fs');

const logo = name => `data:image/png;base64,${fs.readFileSync(`assets/logos/${name}.png`).toString('base64')}`;
const GREEN = '#10A37F';
const ORANGE = '#D97757';
const GOLD = '#F5B800';

function emblem({ dark, animate }) {
  const text = dark ? '#E6EDF3' : '#1F2328';
  const muted = dark ? '#9198A1' : '#59636E';
  const chip = dark ? '#21262D' : '#F6F8FA';
  const chipLine = dark ? '#3D444D' : '#D1D9E0';
  // From under each logo to the middle (x 230), crossing at y 230, 290 and 330, then meeting at the answer.
  const green = [[140, 160], [230, 230], [272, 260], [230, 290], [208, 310], [230, 330], [230, 352]];
  const orange = green.map(([x, y]) => [460 - x, y]);
  const path = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const length = Math.ceil(green.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - green[i][0], y - green[i][1]), 0));
  // When each crossing is reached as the lines draw (2.4 s in all), it lights up.
  const reach = y => (2.4 * (y - 160) / 192).toFixed(2);
  const fade = delay => (animate ? ` class="pop" style="animation-delay:${delay}s"` : '');
  const exchange = (y, n) => `
    <g${fade(reach(y))}><circle cx="230" cy="${y}" r="6" fill="${GOLD}" opacity="0.25"/><circle cx="230" cy="${y}" r="3.2" fill="${GOLD}"/>
    <text x="292" y="${y + 4.5}" class="small" fill="${muted}"><tspan fill="${GOLD}">⇄</tspan> exchange ${n}</text></g>`;
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
  const line = (points, color) => `<path d="${path(points)}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"${animate ? ` class="draw" style="stroke-dasharray:${length}"` : ''}/>`;
  const style = `
      text { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; }
      .label { font-size: 17px; font-weight: 700; }
      .small { font-size: 14px; }
      .chip { font-size: 13px; }${animate ? `
      /* The finished picture is the default; the animations start from hidden (backwards fill), so a viewer that
         does not animate still shows everything. */
      .draw { animation: draw 2.4s ease-in-out 0.3s backwards; }
      .pop { animation: pop 0.45s ease-out backwards; }
      @keyframes draw { from { stroke-dashoffset: ${length}; } to { stroke-dashoffset: 0; } }
      @keyframes pop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }
      .pop { transform-box: fill-box; transform-origin: center; }
      @media (prefers-reduced-motion: reduce) { .draw, .pop { animation: none; } }` : ''}`;
  const body = `
  <image href="${logo('openai')}" x="90" y="22" width="100" height="100"${dark ? '' : ' filter="url(#invert)"'}/>
  <image href="${logo('claude')}" x="270" y="22" width="100" height="100"/>
  <text x="140" y="148" class="label" fill="${GREEN}" text-anchor="middle">ChatGPT</text>
  <text x="320" y="148" class="label" fill="${ORANGE}" text-anchor="middle">Claude</text>
  ${line(green, GREEN)}
  ${line(orange, ORANGE)}
  ${exchange(230, 1)}${exchange(290, 2)}${exchange(330, 3)}
  <g${fade((2.4 + 0.5).toFixed(2))}><path d="M230,345 L238,355 L230,365 L222,355 Z" fill="${GOLD}"/>
  <text x="246" y="360" class="small" fill="${GOLD}" font-weight="700">one answer</text></g>
  <text x="470" y="118" font-size="30" font-weight="600" fill="${text}">Codex–Claude</text>
  <text x="468" y="190" font-size="76" font-weight="800" letter-spacing="6" fill="url(#brand)">COUNCIL</text>
  <text x="470" y="236" font-size="19" fill="${muted}"><tspan fill="${GREEN}" font-weight="700">ChatGPT</tspan> and <tspan fill="${ORANGE}" font-weight="700">Claude</tspan> discuss with each other until they agree</text>
  ${chipRow.join('\n  ')}`;
  const defs = `<defs>
    <linearGradient id="brand" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${GREEN}"/><stop offset="1" stop-color="${ORANGE}"/></linearGradient>
    <filter id="invert"><feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"/></filter>
    <style>${style}
    </style>
  </defs>`;
  return { defs, body };
}

const LABEL = 'Codex–Claude Council: ChatGPT and Claude discuss with each other until they agree';
for (const theme of ['dark', 'light']) {
  const { defs, body } = emblem({ dark: theme === 'dark', animate: true });
  fs.writeFileSync(`assets/banner-${theme}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="380" viewBox="0 0 1000 380" role="img" aria-label="${LABEL}">
  ${defs}${body}
</svg>
`);
}

// The social preview (GitHub: Settings > Social preview): 1280x640, the dark banner on its background.
const { defs, body } = emblem({ dark: true, animate: false });
fs.writeFileSync('assets/social-preview.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-label="${LABEL}">
  ${defs}
  <rect width="1280" height="640" fill="#0D1117"/>
  <rect x="0" y="0" width="1280" height="6" fill="url(#brand)"/>
  <g transform="translate(140,110)">${body}
  </g>
  <text x="640" y="575" text-anchor="middle" font-size="22" fill="#9198A1" font-family="ui-monospace, 'Cascadia Mono', Consolas, monospace">npx -y github:hamza-aziz-ai/codex-claude-council install</text>
</svg>
`);
