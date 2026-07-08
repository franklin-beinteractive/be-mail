import type { OpdrachtStatus } from "../../lib/opdrachten-types";
import { STATUS_NAAM, WAARSCHUWING_STATUSSEN } from "../../lib/opdrachten-types";

export default function StatusBadge({ status, ronde }: { status: OpdrachtStatus; ronde?: number }) {
  const soort = WAARSCHUWING_STATUSSEN.includes(status)
    ? " waarschuwing"
    : status === "afgerond"
      ? " klaar"
      : status === "geannuleerd"
        ? " dood"
        : "";
  return (
    <span className={`opdr-badge${soort}`}>
      {STATUS_NAAM[status]}
      {ronde != null && ronde > 1 && <span className="opdr-badge-ronde">R{ronde}</span>}
    </span>
  );
}
