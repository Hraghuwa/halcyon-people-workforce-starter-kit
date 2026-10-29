// Bundles the simulator screen into one HTML file: bun scripts/build-ui.ts
import { readFileSync, writeFileSync } from "node:fs";
const out = await Bun.build({ entrypoints: ["src/ui/main.ts"], target: "browser", format: "iife", minify: false });
if (!out.success) { console.error(out.logs); process.exit(1); }
const js = (await out.outputs[0].text()).replaceAll("</script>", "<\\/script>");
writeFileSync("simulator.html", readFileSync("src/ui/template.html", "utf8").replace("/*BUNDLE*/", () => js));
console.log("Wrote simulator.html");
