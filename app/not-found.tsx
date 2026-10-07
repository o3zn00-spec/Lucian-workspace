"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageShell } from "@/components/ui/PageShell";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <PageShell width="default">
      <PageHeader
        title="Not found"
        description="The page you were looking for doesn't exist or hasn't been built yet."
      />
      <div className="mt-6">
        <Link href="/">
          <Button variant="secondary" size="md">
            Back to Home
          </Button>
        </Link>
      </div>
    </PageShell>
  );
}
