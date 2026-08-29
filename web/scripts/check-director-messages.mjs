import { readFileSync } from "node:fs";

const content = readFileSync(new URL("../public/director/assets/index-oQuo7db8.js", import.meta.url), "utf8");
for (const [index, line] of content.split("\n").entries()) {
  let start = 0;
  while (true) {
    const found = line.indexOf('"storyai:director-close"', start);
    if (found === -1) break;
    console.log(`line ${index + 1}: ...${line.slice(Math.max(0, found - 260), found + 260)}...`);
    start = found + 1;
  }
}
