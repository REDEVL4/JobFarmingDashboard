import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
      <h2 className="text-xl font-bold text-foreground">404 - Page Not Found</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        The requested telemetry view or application record could not be found.
      </p>
      <Link href="/">
        <Button variant="outline" size="sm">
          Return to Dashboard
        </Button>
      </Link>
    </div>
  );
}
