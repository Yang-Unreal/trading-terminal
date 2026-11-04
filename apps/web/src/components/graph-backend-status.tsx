"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "disconnected";

export function GraphBackendStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000"}/health`)
      .then((response) => {
        if (active) setStatus(response.ok ? "connected" : "disconnected");
      })
      .catch(() => {
        if (active) setStatus("disconnected");
      });
    return () => {
      active = false;
    };
  }, []);

  const isConnected = status === "connected";
  const isChecking = status === "checking";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`h-2 w-2 rounded-full ${
          isChecking ? "bg-orange-400" : isConnected ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span className="text-sm text-muted-foreground">
        {isChecking ? "Checking..." : isConnected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}
