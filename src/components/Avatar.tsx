// Afzender-avatar: initialen op een vaste kleur per persoon.
//
// Bewust geen foto's uit Microsoft Graph: /users/{id}/photo vraagt de scope
// User.ReadBasic.All (tenant-brede admin consent) en werkt sowieso niet voor
// externe afzenders of IMAP-accounts. Initialen werken altijd, ook offline.

/** Initialen uit naam of e-mailadres: "Bart van Esch" -> "BE", "sentry@x.nl" -> "S". */
export function initialsOf(name?: string | null, address?: string | null): string {
  const src = (name || "").trim();
  if (src) {
    // Tussenvoegsels ("van", "de") tellen niet mee als initiaal.
    const parts = src
      .split(/[\s,]+/)
      .filter((p) => p.length > 0 && !/^(van|de|der|den|del|di|du|la|le|el|of)$/i.test(p));
    const letters = parts
      .map((p) => [...p].find((c) => /\p{L}/u.test(c)) ?? "")
      .filter(Boolean);
    if (letters.length >= 2) return (letters[0] + letters[letters.length - 1]).toUpperCase();
    if (letters.length === 1) return letters[0].toUpperCase();
  }
  const addr = (address || "").trim();
  const first = [...addr].find((c) => /\p{L}/u.test(c));
  return first ? first.toUpperCase() : "?";
}

/** Palet met genoeg contrast voor witte tekst, in licht en donker thema. */
const COLORS = [
  "#b4009e",
  "#0f6cbd",
  "#0b6a0b",
  "#c239b3",
  "#8764b8",
  "#c50f1f",
  "#986f0b",
  "#005b70",
  "#4f6bed",
  "#ae4d18",
  "#3a6b35",
  "#7719aa",
];

/** Zelfde afzender = altijd dezelfde kleur (stabiele hash over het adres). */
export function avatarColor(key: string): string {
  let h = 0;
  for (const ch of key.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export default function Avatar({
  name,
  address,
  size = 30,
}: {
  name?: string | null;
  address?: string | null;
  /** Diameter in px. */
  size?: number;
}) {
  const label = name || address || "";
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: avatarColor(address || label),
        fontSize: Math.round(size * 0.4),
      }}
      title={label}
      aria-hidden="true"
    >
      {initialsOf(name, address)}
    </span>
  );
}
