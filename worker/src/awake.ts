// Ruhezustand: Mac während der Arbeit wach halten und erkennen, wenn er trotzdem geschlafen hat.
import { spawn, type ChildProcess } from "node:child_process";

/** Hält den Mac wach, solange hold(true) gilt. Der Bildschirm darf ausgehen. Auf anderen Systemen ohne Wirkung. */
export class KeepAwake {
  private child: ChildProcess | null = null;
  private readonly command: string | null;

  constructor(command: string | null = process.platform === "darwin" ? "/usr/bin/caffeinate" : null) {
    this.command = command;
  }

  get active(): boolean {
    return this.child !== null;
  }

  hold(on: boolean): void {
    if (!on) {
      this.child?.kill();
      this.child = null;
      return;
    }
    if (this.child || !this.command) return;
    // -i: kein Ruhezustand bei Untätigkeit, -s: am Netzteil auch nicht aus dem Hintergrund-Aufwachen heraus,
    // -w: endet mit dem Worker, auch wenn dieser abstürzt
    const child = spawn(this.command, ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" });
    this.child = child;
    const gone = () => {
      if (this.child === child) this.child = null;
    };
    child.on("error", gone).on("exit", gone);
    child.unref();
  }
}

/** Erkennt eine Pause des ganzen Rechners daran, dass ein regelmäßiger Takt ausgeblieben ist. */
export class SleepDetector {
  private last: number;
  private readonly thresholdMs: number;

  constructor(thresholdMs: number, now = Date.now()) {
    this.thresholdMs = thresholdMs;
    this.last = now;
  }

  /** Dauer der Pause in ms oder 0. Muss regelmäßig aufgerufen werden. */
  tick(now = Date.now()): number {
    const gap = now - this.last;
    this.last = now;
    return gap > this.thresholdMs ? gap : 0;
  }
}

export function sleepReason(gapMs: number): string {
  const length = gapMs < 60_000 ? `${Math.round(gapMs / 1000)} s` : `${Math.round(gapMs / 60_000)} min`;
  return `Rechner war ${length} im Ruhezustand, Scan abgebrochen`;
}
