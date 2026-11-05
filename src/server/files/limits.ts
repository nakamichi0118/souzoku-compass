/** 書類の保存の上限と、受け付ける書類の種類 */
import { DOCS } from "@/domain/procedures/documents";
import { EXTRA_DOCS } from "@/domain/filing/submission";

export const FILE_LIMITS = { bytes: 8 * 1024 * 1024, files: 300, totalBytes: 200 * 1024 * 1024 };
export const FILE_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
export const isDocId = (id: unknown): id is string => typeof id === "string" && (id in DOCS || id in EXTRA_DOCS);
