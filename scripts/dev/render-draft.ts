/** 開発用：デモの相続で「下書き」入りの申告書PDFを作る（npx tsx scripts/dev/render-draft.ts out.pdf） */
import fs from "node:fs";
import { demoCase } from "../../src/data/demo";
import { draftReason } from "../../src/domain/review/topics";
import { calculate } from "../../src/domain/tax/engine";
import { buildFilingPages } from "../../src/forms/filing";
import { renderForms } from "../../src/forms/render";

const r = calculate(demoCase);
renderForms(buildFilingPages(demoCase, r), { draft: draftReason(undefined) }).then((b) => fs.writeFileSync(process.argv[2] ?? "draft.pdf", b));
