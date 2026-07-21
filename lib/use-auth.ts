"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/api";

/** Redirects to the welcome screen if there's no access token. Returns true once allowed. */
export function useRequireAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (getAccessToken()) {
      setReady(true);
    } else {
      router.replace("/");
    }
  }, [router]);

  return ready;
}
