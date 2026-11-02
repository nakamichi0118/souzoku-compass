import { Suspense } from "react";
import { DocsPage } from "@/components/my/DocsPage";

export default function Page() {
  return (
    <Suspense>
      <DocsPage />
    </Suspense>
  );
}
