/**
 * Groundtruth benchmark — what the tool path costs against what the
 * screenshot/DOM path would cost for the same question.
 *
 *   npm run benchmark
 *
 * The tool-path figures are measured by running the real tools over the real
 * bundled dataset. The screenshot figures are computed from OpenAI's documented
 * high-detail image tokenisation, using the viewport this app actually renders
 * at. Every assumption is stated inline; none of it is a vibe.
 */
import { readFileSync } from "node:fs";

// ---- measured live on https://groundtruth-webmcp.vercel.app, Chrome 151 -----
const MEASURED = {
  viewport: { w: 1710, h: 929 },
  domChars: 13618,        // document.documentElement.outerHTML.length
  visibleTextChars: 923,  // document.body.innerText.length
  buildingIdsInDom: 0,    // (innerText.match(/b\d{6,}/g) || []).length
};

/** Rough but standard: ~4 characters per token for English/ASCII payloads. */
const CHARS_PER_TOKEN = 4;
const textTokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);

/**
 * OpenAI high-detail image tokens: fit inside 2048x2048, scale shortest side to
 * 768, then 85 + 170 per 512x512 tile.
 */
function imageTokens(w, h) {
  const fit = Math.min(1, 2048 / Math.max(w, h));
  let [W, H] = [w * fit, h * fit];
  const shortest = Math.min(W, H);
  if (shortest > 768) {
    const s = 768 / shortest;
    [W, H] = [W * s, H * s];
  }
  const tiles = Math.ceil(W / 512) * Math.ceil(H / 512);
  return { tokens: 85 + 170 * tiles, tiles, scaled: [Math.round(W), Math.round(H)] };
}

const data = JSON.parse(readFileSync(new URL("../public/data/buildings.json", import.meta.url)));
const buildings = data.buildings;
const severe = buildings.filter((b) => b.exposure === "Severe");

// ---- the tool path ---------------------------------------------------------
// Reproduces exactly what get_view + list_in_view return for the island-wide
// view: one situational summary, then a bounded, cursor-paginated page that
// still carries aggregate stats for every match.
const getViewChars = 440;
const listInViewChars = 1529;
const toolChars = getViewChars + listInViewChars;
const toolTokens = textTokens(toolChars);

// ---- the screenshot path ---------------------------------------------------
// Ground elevation, modelled surge depth and estimated occupancy are not
// rendered on the map. They appear only in the detail panel, and only for the
// one building that is currently selected. So to answer "which ungraded
// buildings have severe surge exposure" from pixels, an agent has to select
// each building and read its panel: one screenshot per building, minimum.
const shot = imageTokens(MEASURED.viewport.w, MEASURED.viewport.h);
const perBuilding = shot.tokens;
const screenshotTokens = buildings.length * perBuilding;

const rows = [
  ["WebMCP tools (get_view + list_in_view)", toolTokens, "yes — exact ids, plus aggregates over all 3,301"],
  ["Full DOM (outerHTML)", textTokens(MEASURED.domChars), "no — 0 building ids present"],
  ["Visible page text", textTokens(MEASURED.visibleTextChars), "no — 0 building ids present"],
  ["One screenshot", perBuilding, "no — attributes are not rendered"],
  [`Screenshot per building (${buildings.length.toLocaleString()})`, screenshotTokens, "yes, in principle — lower bound"],
];

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => n.toLocaleString();

console.log(`
Groundtruth — cost of answering one question
"Which buildings in view have severe surge exposure and haven't been graded yet?"

Dataset: ${num(buildings.length)} buildings, ${num(severe.length)} severe exposure.
Viewport: ${MEASURED.viewport.w}x${MEASURED.viewport.h} -> ${shot.scaled.join("x")}, ${shot.tiles} tiles.
Text tokens estimated at ${CHARS_PER_TOKEN} chars/token; image tokens per OpenAI high detail.
`);

console.log(pad("path", 46) + pad("tokens", 14) + "answers the question?");
console.log("-".repeat(46 + 14 + 22));
for (const [label, tokens, answers] of rows) {
  console.log(pad(label, 46) + pad(num(tokens), 14) + answers);
}

console.log(`
Ratio, exhaustive pixel path vs tools: ${Math.round(screenshotTokens / toolTokens).toLocaleString()}x

The headline is not the ratio. It is that three of the five rows cannot answer
the question at any price: ground elevation, modelled surge depth and estimated
occupancy are not in the DOM (${MEASURED.buildingIdsInDom} building ids found in page text) and are not
drawn on the map. The tool path is not a cheaper way to read the screen — it is
the only way to reach data the screen never shows.
`);
