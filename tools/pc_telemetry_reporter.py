#!/usr/bin/env python3
"""Reporta telemetria real do PC (CPU, RAM, disco, GPU, top processos) pro
Hermes Cloud a cada poucos segundos, via POST autenticado no Worker.

Uso:
    python tools/pc_telemetry_reporter.py

Lê HERMES_CLOUD_WORKER_URL e HERMES_DASHBOARD_API_SECRET do .env na raiz do
projeto. Roda em loop até Ctrl+C; cada falha de rede é só um ciclo perdido,
não derruba o processo (o PC pode estar sem internet momentaneamente).

Leve de propósito (pedido do usuário 13/08/2026 — as janelas de console do
nvidia-smi estavam atrapalhando a navegação):
- nvidia-smi roda com janela oculta (CREATE_NO_WINDOW) e só a cada 3 ciclos,
  não todo ciclo — é o subprocess mais caro do script.
- cpu_percent não bloqueia 1s por ciclo (usa o intervalo do próprio loop
  como amostra, non-blocking).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import psutil

INTERVAL_SECONDS = 15
GPU_EVERY_N_CYCLES = 3  # nvidia-smi é o subprocess mais caro — não roda todo ciclo
REPO_ROOT = Path(__file__).resolve().parent.parent

# Esconde a janela de console de QUALQUER subprocess.run neste script
# (nvidia-smi etc.) — sem isso cada chamada pisca um cmd.exe na tela.
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def load_env(path: Path) -> dict:
    values = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


ENV = {**load_env(REPO_ROOT / ".env"), **os.environ}
WORKER_URL = ENV.get("HERMES_CLOUD_WORKER_URL", "").rstrip("/")
API_SECRET = ENV.get("HERMES_DASHBOARD_API_SECRET", "")

if not WORKER_URL or not API_SECRET:
    print("[telemetry] HERMES_CLOUD_WORKER_URL / HERMES_DASHBOARD_API_SECRET ausentes no .env — abortando.")
    sys.exit(1)


_last_gpu_stats: dict = {}


def gpu_stats() -> dict:
    """Best-effort via nvidia-smi. Sem GPU NVIDIA, volta vazio (sem inventar dado)."""
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=3,
            creationflags=_NO_WINDOW,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return {}
        name, util, mem_used, mem_total = [p.strip() for p in out.stdout.strip().splitlines()[0].split(",")]
        return {"gpuName": name, "gpuPercent": float(util), "gpuMemUsedMB": float(mem_used), "gpuMemTotalMB": float(mem_total)}
    except Exception:
        return {}


_NON_APP_PROCESS_NAMES = {"system idle process", "system", "registry", "memory compression"}


def top_processes(limit: int = 5) -> list[dict]:
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
        try:
            info = p.info
            name = info.get("name")
            if not name or name.strip().lower() in _NON_APP_PROCESS_NAMES:
                continue
            procs.append(
                {
                    "name": info["name"],
                    "pid": info["pid"],
                    "cpuPercent": round(info.get("cpu_percent") or 0.0, 1),
                    "ramPercent": round(info.get("memory_percent") or 0.0, 1),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    procs.sort(key=lambda x: x["cpuPercent"], reverse=True)
    return procs[:limit]


def collect_snapshot(cycle: int) -> dict:
    global _last_gpu_stats
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage(str(Path.home().anchor or "C:\\"))
    snapshot = {
        # non-blocking: compara contra a última chamada, sem dormir 1s aqui
        # (o próprio time.sleep(INTERVAL_SECONDS) do loop já é a amostra).
        "cpuPercent": psutil.cpu_percent(interval=None),
        "cores": psutil.cpu_count(logical=True),
        "ramPercent": vm.percent,
        "ramUsedMB": round(vm.used / (1024 * 1024)),
        "ramTotalMB": round(vm.total / (1024 * 1024)),
        "diskFreeGB": round(disk.free / (1024 ** 3), 1),
        "diskTotalGB": round(disk.total / (1024 ** 3), 1),
        "topProcesses": top_processes(),
        "hostname": os.environ.get("COMPUTERNAME", "pc"),
    }
    if cycle % GPU_EVERY_N_CYCLES == 0:
        _last_gpu_stats = gpu_stats()
    snapshot.update(_last_gpu_stats)
    return snapshot


def send(snapshot: dict) -> bool:
    body = json.dumps(snapshot).encode("utf-8")
    req = urllib.request.Request(
        f"{WORKER_URL}/api/dashboard/telemetry",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_SECRET}",
            "Content-Type": "application/json",
            # Sem isso o Cloudflare bloqueia com 403 (User-Agent padrão do
            # urllib é tratado como bot pelo WAF).
            "User-Agent": "HermesPCTelemetryReporter/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


def main() -> None:
    print(f"[telemetry] Reportando pra {WORKER_URL} a cada {INTERVAL_SECONDS}s. Ctrl+C pra parar.")
    psutil.cpu_percent(interval=None)  # primeira chamada é sempre 0.0 (sem baseline) — descarta
    cycle = 0
    while True:
        try:
            snapshot = collect_snapshot(cycle)
            ok = send(snapshot)
            status = "ok" if ok else "falha de rede (tenta de novo no próximo ciclo)"
            print(f"[telemetry] CPU {snapshot['cpuPercent']}% RAM {snapshot['ramPercent']}% — {status}")
        except Exception as exc:
            print(f"[telemetry] erro no ciclo: {exc}")
        cycle += 1
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[telemetry] encerrado.")
