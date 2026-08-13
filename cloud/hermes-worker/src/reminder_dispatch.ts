import { supabase } from "./shared";

interface DueAgenda { id: number; chat_id: string; title: string; starts_at: string }
interface DueTask { id: number; chat_id: string; title: string; due_date: string }

async function telegramReminder(env: Env, chatId: string, text: string): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return response.ok;
}

async function rows<T>(env: Env, path: string): Promise<T[]> {
  const response = await supabase(env, path);
  return response.ok ? await response.json() as T[] : [];
}

function markerKey(kind: "agenda" | "task", id: number): string {
  return `reminders/sent/${kind}/${id}`;
}

export async function dispatchDueReminders(env: Env, now = new Date()): Promise<{ agenda: number; tasks: number }> {
  const horizon = new Date(now.getTime() + 5 * 60_000).toISOString();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const brazilToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const [agenda, tasks] = await Promise.all([
    rows<DueAgenda>(env, `hermes_cloud_agenda?starts_at=gte.${encodeURIComponent(yesterday)}&starts_at=lte.${encodeURIComponent(horizon)}&select=id,chat_id,title,starts_at&order=starts_at.asc&limit=50`),
    rows<DueTask>(env, `hermes_cloud_tasks?done=eq.false&due_date=lte.${brazilToday}&select=id,chat_id,title,due_date&order=due_date.asc&limit=50`),
  ]);
  let agendaSent = 0;
  let tasksSent = 0;
  for (const item of agenda) {
    const key = markerKey("agenda", item.id);
    if (await env.HERMES_STORAGE.head(key)) continue;
    const when = new Date(item.starts_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
    if (await telegramReminder(env, item.chat_id, `⏰ Lembrete de agenda: ${item.title} — ${when}.`)) {
      await env.HERMES_STORAGE.put(key, now.toISOString()); agendaSent += 1;
    }
  }
  for (const item of tasks) {
    const key = markerKey("task", item.id);
    if (await env.HERMES_STORAGE.head(key)) continue;
    if (await telegramReminder(env, item.chat_id, `📋 Lembrete de tarefa: ${item.title} — prazo ${item.due_date}.`)) {
      await env.HERMES_STORAGE.put(key, now.toISOString()); tasksSent += 1;
    }
  }
  console.log(JSON.stringify({ event: "reminder_dispatch", agenda: agendaSent, tasks: tasksSent }));
  return { agenda: agendaSent, tasks: tasksSent };
}
