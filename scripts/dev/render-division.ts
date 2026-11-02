import fs from "node:fs";
import { demoCase } from "../../src/data/demo";
import { buildDivisionDoc } from "../../src/documents/division";
import { renderDivision } from "../../src/documents/renderDivision";

const d = buildDivisionDoc(demoCase);
console.log(JSON.stringify({ articles: d.articles, warnings: d.warnings }, null, 1));
renderDivision(d).then((b) => fs.writeFileSync(process.argv[2] ?? "division.pdf", b));
