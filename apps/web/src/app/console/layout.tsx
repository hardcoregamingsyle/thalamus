"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { MeProvider, useMe } from "@/components/app/useMe";

function Gate({ children }: { children: ReactNode }) {
  const { me, loading, error } = useMe();
  const router = useRouter();
  const signedOut = !loading && (error || !me?.user);

  useEffect(() => {
    if (signedOut) router.replace("/auth");
  }, [signedOut, router]);

  if (signedOut) return null;
  return <AppShell>{children}</AppShell>;
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <MeProvider>
      <Gate>{children}</Gate>
    </MeProvider>
  );
}
