import { CaseProvider } from "@/lib/store";

export default function CaseLayout({ children }: { children: React.ReactNode }) {
  return <CaseProvider>{children}</CaseProvider>;
}
