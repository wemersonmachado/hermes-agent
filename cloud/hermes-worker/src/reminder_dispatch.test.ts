import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchDueReminders } from "./reminder_dispatch";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("scheduled reminders", () => {
  it("delivers due agenda and marks it only after Telegram succeeds", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("hermes_cloud_agenda?") && !init?.method) return new Response(JSON.stringify([{ id: 7, chat_id: "123", title: "Consulta", starts_at: "2026-08-13T15:00:00Z" }]));
      if (url.includes("hermes_cloud_tasks?") && !init?.method) return new Response("[]");
      if (url.includes("api.telegram.org")) return new Response(JSON.stringify({ ok: true }));
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const markers = new Map<string, string>();
    const bucket = { head: vi.fn(async (key: string) => markers.has(key) ? ({ key }) : null), put: vi.fn(async (key: string, value: string) => { markers.set(key, value); }) };
    const env = { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "key", TELEGRAM_BOT_TOKEN: "token", HERMES_STORAGE: bucket } as unknown as Env;
    const result = await dispatchDueReminders(env, new Date("2026-08-13T14:58:00Z"));
    expect(result).toEqual({ agenda: 1, tasks: 0 });
    expect(bucket.put).toHaveBeenCalledWith("reminders/sent/agenda/7", "2026-08-13T14:58:00.000Z");
    await dispatchDueReminders(env, new Date("2026-08-13T14:59:00Z"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("api.telegram.org"))).toHaveLength(1);
  });
});
