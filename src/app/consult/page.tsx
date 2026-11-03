import { Suspense } from "react";
import { ConsultPage } from "@/components/compass/ConsultPage";

export const metadata = { title: "税理士に相談する｜相続コンパス" };

export default function Page() {
  return (
    <Suspense>
      <ConsultPage />
    </Suspense>
  );
}
