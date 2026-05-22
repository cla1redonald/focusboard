/**
 * Demo mode lets visitors hit the live URL and explore Focusboard with a
 * populated board, without signing up or touching Supabase.
 *
 * Activation: ?demo=1 in the URL, or clicking "Try the demo" on the login
 * page. Both routes set a localStorage flag that survives reloads.
 */
import type { Card } from "./types";

const DEMO_MODE_KEY = "focusboard:demo_mode";
const DEMO_SEED_FLAG = "focusboard:demo_seeded";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  // URL param takes precedence — supports linking directly to demo mode.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") {
      localStorage.setItem(DEMO_MODE_KEY, "true");
      // Strip the param so reloads don't re-set it after exit.
      params.delete("demo");
      const newSearch = params.toString();
      const newUrl =
        window.location.pathname +
        (newSearch ? `?${newSearch}` : "") +
        window.location.hash;
      window.history.replaceState({}, "", newUrl);
      return true;
    }
  } catch {
    // URL parsing should never throw, but stay defensive in case of SSR.
  }
  try {
    return localStorage.getItem(DEMO_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function enableDemoMode(): void {
  localStorage.setItem(DEMO_MODE_KEY, "true");
}

export function exitDemoMode(): void {
  localStorage.removeItem(DEMO_MODE_KEY);
  localStorage.removeItem(DEMO_SEED_FLAG);
  // Wipe demo board data so it doesn't leak into a fresh experience.
  localStorage.removeItem("focusboard:v4");
  localStorage.removeItem("focusboard:metrics");
}

export function hasSeededDemo(): boolean {
  try {
    return localStorage.getItem(DEMO_SEED_FLAG) === "true";
  } catch {
    return false;
  }
}

export function markDemoSeeded(): void {
  try {
    localStorage.setItem(DEMO_SEED_FLAG, "true");
  } catch {
    // ignore quota errors
  }
}

const dateOnly = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
};

const ago = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

type DemoCardOpts = {
  swimlane?: "work" | "personal";
  order?: number;
  icon?: string;
  tags?: string[];
  dueDate?: string;
  age?: number;
  updated?: number;
  completedAt?: string;
  blockedReason?: string;
};

function makeDemoCard(
  id: string,
  column: string,
  title: string,
  opts: DemoCardOpts = {}
): Card {
  return {
    id,
    column,
    swimlane: opts.swimlane ?? "work",
    title,
    order: opts.order ?? 0,
    icon: opts.icon,
    tags: opts.tags ?? [],
    dueDate: opts.dueDate,
    createdAt: ago(opts.age ?? 3),
    updatedAt: ago(opts.updated ?? 1),
    completedAt: opts.completedAt,
    blockedReason: opts.blockedReason,
    columnHistory: [],
  };
}

/**
 * Returns the seed cards used to populate a fresh demo board. Chosen to
 * exercise every visible feature: WIP limits, urgency colours, the blocked
 * state, completed cards (for metrics), and both swimlanes.
 */
export function getDemoCards(): Card[] {
  return [
    // Work — Backlog
    makeDemoCard("demo-c1", "backlog", "Spike: explore real-time collab options", {
      tags: ["research", "medium"],
      age: 7,
    }),
    makeDemoCard("demo-c2", "backlog", "Investigate vector embeddings for card search", {
      tags: ["research", "low"],
      age: 10,
    }),
    makeDemoCard("demo-c3", "backlog", "Outline OKR retrospective format", {
      tags: ["planning"],
      age: 5,
    }),

    // Work — Design & Planning
    makeDemoCard("demo-c4", "design", "New onboarding flow — Figma review", {
      tags: ["design", "high"],
      dueDate: dateOnly(2),
      age: 4,
    }),
    makeDemoCard("demo-c5", "design", "Pricing page A/B variants", {
      tags: ["design", "medium"],
      dueDate: dateOnly(5),
      age: 2,
      order: 1,
    }),

    // Work — To Do
    makeDemoCard("demo-c6", "todo", "Migrate auth context to React 19 patterns", {
      tags: ["eng", "medium"],
      dueDate: dateOnly(3),
      age: 6,
    }),
    makeDemoCard("demo-c7", "todo", "Write release notes for v2.4", {
      tags: ["comms", "low"],
      dueDate: dateOnly(1),
      age: 2,
      order: 1,
    }),
    makeDemoCard("demo-c8", "todo", "Refactor metrics dashboard chart", {
      tags: ["eng"],
      age: 3,
      order: 2,
    }),

    // Work — Doing
    makeDemoCard("demo-c9", "doing", "Portfolio refresh — Focusboard", {
      tags: ["high", "eng"],
      dueDate: dateOnly(0),
      age: 1,
      icon: "⚡",
    }),
    makeDemoCard("demo-c10", "doing", "Customer interview notes — synthesise", {
      tags: ["research", "medium"],
      age: 2,
      order: 1,
    }),

    // Work — Blocked
    makeDemoCard("demo-c11", "blocked", "Switch CI to Node 22", {
      tags: ["eng", "medium"],
      blockedReason: "Waiting on devops to provision new runners",
      age: 4,
    }),

    // Work — Done
    makeDemoCard("demo-c12", "done", 'Ship "Won\'t Do" terminal column', {
      tags: ["eng"],
      age: 8,
      updated: 4,
      completedAt: ago(4),
    }),
    makeDemoCard("demo-c13", "done", "Card archive system rollout", {
      tags: ["eng"],
      age: 14,
      updated: 6,
      completedAt: ago(6),
      order: 1,
    }),
    makeDemoCard("demo-c14", "done", "Capture Hub MVP", {
      tags: ["eng"],
      age: 20,
      updated: 10,
      completedAt: ago(10),
      order: 2,
    }),

    // Personal swimlane
    makeDemoCard("demo-p1", "backlog", "Book dentist appointment", {
      swimlane: "personal",
      tags: ["admin"],
      age: 12,
    }),
    makeDemoCard("demo-p2", "todo", "Plan weekend hike route", {
      swimlane: "personal",
      dueDate: dateOnly(4),
      age: 3,
    }),
    makeDemoCard("demo-p3", "doing", 'Read "Working in Public"', {
      swimlane: "personal",
      tags: ["learning"],
      age: 5,
    }),
    makeDemoCard("demo-p4", "done", "Renew passport", {
      swimlane: "personal",
      age: 30,
      updated: 15,
      completedAt: ago(15),
    }),
  ];
}
