import { Card } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div>
      <PageHeader title="404" subtitle="Page not found" />
      <div className="px-4 sm:px-6">
        <Card className="flex items-center gap-4 py-6">
          <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={18} className="text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Page Not Found</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Did you forget to add the page to the router?
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
