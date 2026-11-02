import fs from "node:fs";
import { demoCase } from "../../src/data/demo";
import { calculate } from "../../src/domain/tax/engine";
import { buildFilingPages } from "../../src/forms/filing";
import { renderForms } from "../../src/forms/render";

const r = calculate(demoCase);
console.log(JSON.stringify({ total: r.totalTaxable, tax: r.totalTax, pay: r.totalPayable, persons: r.persons.map((p) => [p.person.name, p.taxable, p.computed, p.payable]), warnings: r.warnings, blockers: r.blockers }, null, 1));
const out = process.argv[2] ?? "demo.pdf";
renderForms(buildFilingPages(demoCase, r)).then((b) => fs.writeFileSync(out, b));
