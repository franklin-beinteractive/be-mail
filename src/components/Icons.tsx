// Kleine, schaalbare inline-SVG-iconen (geen externe iconbibliotheek).
import type { CSSProperties } from "react";

type Props = { size?: number; style?: CSSProperties };

const base = (size: number): CSSProperties => ({
  width: size,
  height: size,
  display: "inline-block",
  verticalAlign: "middle",
  flexShrink: 0,
});

function Svg({ size = 20, style, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ ...base(size), ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const MailIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Svg>
);
export const CalendarIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </Svg>
);
export const SettingsIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a7.9 7.9 0 0 0 .1-6l-2 .5a6 6 0 0 0-1-1l.4-2a7.9 7.9 0 0 0-6 0l.4 2a6 6 0 0 0-1 1l-2-.5a7.9 7.9 0 0 0 0 6l2-.5a6 6 0 0 0 1 1l-.4 2a7.9 7.9 0 0 0 6 0l-.4-2a6 6 0 0 0 1-1z" />
  </Svg>
);
export const ComposeIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
);
export const ReplyIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M9 17 4 12l5-5" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </Svg>
);
export const ReplyAllIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M7 17 2 12l5-5M12 17l-5-5 5-5" />
    <path d="M22 18v-2a4 4 0 0 0-4-4H7" />
  </Svg>
);
export const ForwardIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m15 17 5-5-5-5" />
    <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
  </Svg>
);
export const TrashIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </Svg>
);
export const FlagIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 21V4h13l-2 4 2 4H4" />
  </Svg>
);
export const ArchiveIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v12h14V8M10 12h4" />
  </Svg>
);
export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </Svg>
);
export const EditIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
);
export const SearchIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);
export const PlusIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const SendIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </Svg>
);
export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const ChevronLeft = (p: Props) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);
export const ChevronRight = (p: Props) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);
export const PaperclipIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M21 12 12 21a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
  </Svg>
);
