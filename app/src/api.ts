import { invoke } from "@tauri-apps/api/core";
import { writeText as writeClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";

export const SUBSCRIPTION_URL =
  "https://raw.githubusercontent.com/mahdyaralipor/v2all/main/real_sub.txt";
export const REPOSITORY_URL = "https://github.com/mahdyaralipor/v2all";

export const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type Config = {
  proto: string;
  host: string;
  port: number;
  remark?: string | null;
  ms?: number | null;
  link: string;
};

export type Snapshot = {
  updated?: string | null;
  stats?: Record<string, number> | null;
  configs: Config[];
};

export type Connection = {
  connected: boolean;
  host?: string | null;
  port?: number | null;
  remark?: string | null;
  sinceMs: number;
  proxy: boolean;
  note?: string | null;
};

export async function loadSnapshot(): Promise<Snapshot> {
  if (IS_DESKTOP) return invoke<Snapshot>("get_snapshot");
  const response = await fetch("/sub-data.json");
  if (!response.ok) throw new Error(`data.json returned ${response.status}`);
  return (await response.json()) as Snapshot;
}

export async function testLatency(
  host: string,
  port: number,
): Promise<number | null> {
  if (!IS_DESKTOP) return null;
  return invoke<number | null>("test_latency", { host, port, timeout: 1500 });
}

export async function connect(config: Config): Promise<Connection> {
  if (!IS_DESKTOP) {
    throw new Error("Connecting runs in the desktop app. This is a browser preview.");
  }
  return invoke<Connection>("connect", {
    link: config.link,
    remark: config.remark ?? null,
    host: config.host,
    port: config.port,
  });
}

export async function disconnect(): Promise<void> {
  if (IS_DESKTOP) await invoke("disconnect");
}

export async function getStatus(): Promise<Connection | null> {
  if (!IS_DESKTOP) return null;
  return invoke<Connection | null>("connection_status");
}

export async function copyText(text: string): Promise<boolean> {
  if (IS_DESKTOP) {
    try {
      await writeClipboard(text);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function openRepository(): Promise<void> {
  if (IS_DESKTOP) {
    await openUrl(REPOSITORY_URL);
    return;
  }
  window.open(REPOSITORY_URL, "_blank", "noopener");
}
