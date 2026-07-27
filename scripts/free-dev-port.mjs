// Maakt poort 1420 vrij vóór `npm run dev` (npm draait dit als "predev",
// dus ook wanneer `tauri dev` het dev-commando aanroept).
//
// Waarom: vite draait met strictPort omdat devUrl in tauri.conf.json vast op
// 1420 staat. Blijft er na een afgebroken dev-sessie een vite-proces hangen -
// op Windows overleeft node.exe het sluiten van de npm-wrapper regelmatig -
// dan start de app niet meer op met "Port 1420 is already in use".
//
// Het script stopt ALLEEN een achtergebleven vite-proces. Houdt iets anders de
// poort bezet, dan wordt er niets afgeschoten: dat kan werk zijn waar je niets
// van weet. Je krijgt dan te zien wat het is en beslist zelf.

import { execFileSync } from "node:child_process";

const PORT = Number(process.argv[2] ?? 1420);
const isWindows = process.platform === "win32";

/** Stil uitvoeren; een niet-nul exitcode betekent hier gewoon "niets gevonden". */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** PID's die op de poort luisteren (zowel IPv4 als IPv6). */
function listeningPids() {
  if (isWindows) {
    // Geen "-p tcp": dat toont alleen IPv4, terwijl vite op [::1] luistert.
    const out = run("netstat", ["-ano"]);
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // Bv.: TCP  [::1]:1420  [::]:0  LISTENING  22896
      // Niet op "LISTENING" filteren: dat woord is vertaald op een
      // Nederlandse Windows. Het lokale adres op onze poort is genoeg -
      // een uitgaande verbinding heeft 1420 als REMOTE adres (kolom 3).
      if (cols.length < 5) continue;
      if (!cols[0].toUpperCase().startsWith("TCP")) continue;
      if (!cols[1].endsWith(`:${PORT}`)) continue;
      const pid = Number(cols[cols.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }
  const out = run("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"]);
  return out
    .split(/\s+/)
    .map(Number)
    .filter((p) => Number.isInteger(p) && p > 0);
}

/** De opdrachtregel van een proces, om te bepalen of het van ons is. */
function commandLineOf(pid) {
  if (isWindows) {
    return run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ]).trim();
  }
  return run("ps", ["-p", String(pid), "-o", "command="]).trim();
}

function kill(pid) {
  if (isWindows) run("taskkill", ["/PID", String(pid), "/F"]);
  else process.kill(pid, "SIGKILL");
}

for (const pid of listeningPids()) {
  const cmd = commandLineOf(pid);
  // Alleen een vite-dev-server opruimen; al het andere blijft met rust.
  if (/vite/i.test(cmd)) {
    kill(pid);
    console.log(`[dev] achtergebleven vite op poort ${PORT} gestopt (pid ${pid})`);
  } else {
    console.error(
      `[dev] Poort ${PORT} is bezet door pid ${pid}, en dat is geen vite:\n` +
        `      ${cmd || "(opdrachtregel onbekend)"}\n` +
        `      Niets afgesloten. Stop dat proces zelf of geef vite een andere poort ` +
        `(vite.config.ts én devUrl in src-tauri/tauri.conf.json).`
    );
    process.exit(1);
  }
}
