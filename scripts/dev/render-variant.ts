// 開発用：デモに死亡退職金と障害者を加えた架空の事例で、第6表・第9表・第10表・付表1の記入を確かめる
import fs from "node:fs";
import { demoCase } from "../../src/data/demo";
import { calculate } from "../../src/domain/tax/engine";
import { buildFilingPages } from "../../src/forms/filing";
import { renderForms } from "../../src/forms/render";
import type { Case } from "../../src/domain/types";

const c: Case = structuredClone(demoCase);
c.persons = c.persons.map((p, i) => (i === 1 ? { ...p, disability: "general" as const } : p));
c.assets.push({ id: "ret", kind: "retirement", label: "みほん商事株式会社 死亡退職金", amount: 18_000_000, recipientId: c.persons[0].id });
c.assets.push({ id: "ins2", kind: "insurance", label: "さんぷる生命 死亡保険金", amount: 3_000_000, recipientId: c.persons[1].id });
const r = calculate(c);
console.log(JSON.stringify({ blockers: r.blockers, persons: r.persons.map((p) => [p.person.name, p.minorCredit, p.disabilityCredit, p.insurance, p.insuranceExempt, p.retirement, p.retirementExempt]) }));
const pages = buildFilingPages(c, r);
console.log(pages.map((p) => p.page).join(" "));
renderForms(pages).then((b) => fs.writeFileSync(process.argv[2] ?? "variant.pdf", b));
