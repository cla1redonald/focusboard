import { FocusboardClient, type DigestCard, type FocusAggregates } from "../client.js";
import { saveAliases } from "../aliases.js";
import { info, isJson, printJson, paint, table, truncate } from "../output.js";

/**
 * Phase 5a — review digests: fb shutdown (daily) and fb week (weekly).
 * Server-side composites of the SAME review.ts semantics the web's Shutdown
 * and Weekly Review panels render from; focus data arrives as aggregates.
 */

function focusLine(focus: FocusAggregates): string {
  if (focus.sessionCount === 0) return paint("no focus sessions", "dim");
  const outcomes = Object.entries(focus.byOutcome)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  return `${focus.sessionCount} session${focus.sessionCount === 1 ? "" : "s"} · ${focus.totalMinutes}m focused (${outcomes})`;
}

type Section = { title: string; cards: DigestCard[]; emptyLabel: string };

/** One shared c-N alias space across all sections (same registry as fb list). */
function renderSections(sections: Section[]) {
  const allIds = sections.flatMap((s) => s.cards.map((card) => card.id));
  saveAliases(allIds, "c");
  let n = 0;
  for (const s of sections) {
    info("");
    info(paint(s.title, "bold"));
    if (s.cards.length === 0) {
      info(`  ${paint(s.emptyLabel, "dim")}`);
      continue;
    }
    table(
      s.cards.map((card) => [
        `c-${++n}`,
        truncate(card.title, 48),
        card.column,
        card.dueDate ?? "",
      ]),
      ["id", "title", "column", "due"]
    );
  }
}

export async function shutdownCommand() {
  const client = new FocusboardClient();
  const digest = await client.reviewDaily();

  if (isJson()) {
    printJson(digest);
    return;
  }

  info(paint(`Daily shutdown — ${digest.date}`, "bold") + (digest.isComplete ? paint("  (already completed in the web app)", "dim") : ""));
  info("");
  info(`${paint("✓", "green")} Completed today: ${digest.completedToday.length}`);
  for (const done of digest.completedToday.slice(0, 7)) {
    info(`  · ${truncate(done.title, 60)}`);
  }
  info(`${paint("●", "cyan")} Focus: ${focusLine(digest.focus)}`);

  renderSections([
    { title: "Slipped (due date passed)", cards: digest.slipped, emptyLabel: "nothing slipped" },
    { title: "Blocked", cards: digest.blocked, emptyLabel: "nothing blocked" },
    { title: "Going stale", cards: digest.stale, emptyLabel: "nothing stale" },
    { title: "Tomorrow candidates", cards: digest.tomorrowCandidates, emptyLabel: "—" },
  ]);
}

export async function weekCommand() {
  const client = new FocusboardClient();
  const digest = await client.reviewWeekly();

  if (isJson()) {
    printJson(digest);
    return;
  }

  info(paint(`Weekly review — week of ${digest.weekKey}`, "bold") + (digest.isComplete ? paint("  (already completed in the web app)", "dim") : ""));
  info("");
  info(`${paint("✓", "green")} Completed this week: ${digest.completedThisWeek.length}`);
  for (const done of digest.completedThisWeek.slice(0, 10)) {
    info(`  · ${truncate(done.title, 60)}`);
  }
  info(`${paint("●", "cyan")} Focus: ${focusLine(digest.focus)}`);

  renderSections([
    { title: "Blocked", cards: digest.blocked, emptyLabel: "nothing blocked" },
    { title: "Stale backlog", cards: digest.staleBacklog, emptyLabel: "backlog is fresh" },
    { title: "Proposed commitments for next week", cards: digest.proposedCommitments, emptyLabel: "—" },
  ]);
}
