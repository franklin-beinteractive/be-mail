// Sender avatar: the profile photo when we have one, initials on a fixed
// colour per person otherwise.
//
// The photo comes from Microsoft Graph (`/users/{address}/photo`) through the
// Rust core, which needs the optional User.ReadBasic.All scope. That scope is
// not always granted, and it only covers colleagues in the same tenant - so an
// external sender, an IMAP account or a tenant without consent simply keeps the
// initials, which always work, offline included.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/ctx";

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

/**
 * Photos already looked up this session, keyed by account + lower-case address:
 * the message list renders an avatar per row and would otherwise ask the core
 * again on every scroll and re-render. `null` means "asked, no photo". The
 * account is part of the key because two mailboxes can live in different
 * tenants, where the same address need not resolve to the same person.
 */
const photos = new Map<string, string | null>();
/** Lookups still running, so ten rows from the same sender share one call. */
const pending = new Map<string, Promise<string | null>>();
/** Cap on the in-memory cache; the core keeps the durable copy in cache.db. */
const MAX_CACHED = 500;

function remember(address: string, uri: string | null): void {
  if (photos.size >= MAX_CACHED) {
    // Map keeps insertion order, so this drops the oldest entry.
    const oldest = photos.keys().next().value;
    if (oldest !== undefined) photos.delete(oldest);
  }
  photos.set(address, uri);
}

function lookupPhoto(key: string, address: string): Promise<string | null> {
  const running = pending.get(key);
  if (running) return running;
  const p = api
    .senderPhoto(address)
    .catch(() => null)
    .then((uri) => {
      remember(key, uri ?? null);
      pending.delete(key);
      return uri ?? null;
    });
  pending.set(key, p);
  return p;
}

/** The sender's photo, or null while it is loading or when there is none. */
function usePhoto(
  address: string | null | undefined,
  accountId: string | null,
  enabled: boolean
): string | null {
  const clean = address ? address.trim().toLowerCase() : "";
  const key = enabled && clean ? `${accountId ?? ""}|${clean}` : "";
  const [photo, setPhoto] = useState<string | null>(() => (key ? photos.get(key) ?? null : null));
  useEffect(() => {
    if (!key) {
      setPhoto(null);
      return;
    }
    if (photos.has(key)) {
      setPhoto(photos.get(key) ?? null);
      return;
    }
    let alive = true;
    void lookupPhoto(key, clean).then((uri) => {
      if (alive) setPhoto(uri);
    });
    return () => {
      alive = false;
    };
    // `clean` is derived from `key`, so it needs no place in the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return photo;
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
  const { capabilities, activeAccountId } = useApp();
  // Only Office 365 accounts have a directory to ask; IMAP stays on initials.
  const photo = usePhoto(address, activeAccountId, capabilities?.graphOnly ?? false);
  const label = name || address || "";
  if (photo) {
    return (
      <img
        className="avatar"
        src={photo}
        style={{ width: size, height: size }}
        title={label}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }
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
