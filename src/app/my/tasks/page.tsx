import { Suspense } from "react";
import { TasksPage } from "@/components/my/TasksPage";

export default function Page() {
  return (
    <Suspense>
      <TasksPage />
    </Suspense>
  );
}
