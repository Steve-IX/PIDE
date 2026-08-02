import { invoke } from "@tauri-apps/api/core";

export interface GitHubUser {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

function errMsg(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function loadGitHubSession(): Promise<GitHubUser | null> {
  return invoke<GitHubUser | null>("github_load_session");
}

export async function refreshGitHubUser(): Promise<GitHubUser | null> {
  return invoke<GitHubUser | null>("github_get_user");
}

export async function clearGitHubSession(): Promise<void> {
  return invoke("github_clear_session");
}

export async function savePat(token: string): Promise<GitHubUser> {
  return invoke<GitHubUser>("github_save_pat", { token });
}

export async function startDeviceFlow(clientId: string): Promise<DeviceStart> {
  return invoke<DeviceStart>("github_device_start", { clientId });
}

export async function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
): Promise<GitHubUser | null> {
  return invoke<GitHubUser | null>("github_device_poll", {
    clientId,
    deviceCode,
  });
}

/** Poll until authorized, denied, or expired. */
export async function completeDeviceFlow(
  clientId: string,
  start: DeviceStart,
  opts?: { signal?: AbortSignal; onTick?: (remainingSec: number) => void },
): Promise<GitHubUser> {
  const deadline = Date.now() + start.expiresIn * 1000;
  let intervalMs = Math.max(1, start.interval) * 1000;

  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) {
      throw new Error("Sign-in cancelled");
    }
    opts?.onTick?.(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));

    try {
      const user = await pollDeviceFlow(clientId, start.deviceCode);
      if (user) return user;
    } catch (err) {
      const msg = errMsg(err).toLowerCase();
      if (msg.includes("slow_down")) {
        intervalMs += 5000;
      } else {
        throw err instanceof Error ? err : new Error(errMsg(err));
      }
    }

    await sleep(intervalMs, opts?.signal);
  }

  throw new Error("Device code expired. Start again.");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Sign-in cancelled"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("Sign-in cancelled"));
      },
      { once: true },
    );
  });
}

export { errMsg as githubAuthErrorMessage };
