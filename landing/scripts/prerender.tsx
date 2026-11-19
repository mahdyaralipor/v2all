import { readFile, writeFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";

const template = await readFile("index.html", "utf8");
const html = renderToStaticMarkup(<App />);
const fontLicense = await readFile("src/assets/OFL.txt", "utf8");
const output = template
  .replace(
    /<!--app:html-->[\s\S]*?<!--\/app:html-->/,
    `<!--app:html-->${html}<!--/app:html-->`,
  )
  .replace(
    /<!--font:license-->[\s\S]*?<!--\/font:license-->/,
    `<!--font:license-->\n${fontLicense}\n<!--/font:license-->`,
  );
if (output === template && !template.includes(html)) {
  throw new Error("Static HTML markers are missing from index.html.");
}
await writeFile("index.html", output);
console.log(
  `Prerendered ${Buffer.byteLength(html).toLocaleString()} bytes of React markup.`,
);
