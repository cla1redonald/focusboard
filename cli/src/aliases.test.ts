import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveAliases, loadAliases, resolveId } from "./aliases.js";
import { parseDuration } from "./commands/snooze.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fb-test-"));
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("aliases", () => {
  it("saves cap-N aliases in inbox order and loads them back", () => {
    const map = saveAliases(["uuid-a", "uuid-b", "uuid-c"]);
    expect(map).toEqual({ "cap-1": "uuid-a", "cap-2": "uuid-b", "cap-3": "uuid-c" });
    expect(loadAliases()).toEqual(map);
  });

  it("resolveId maps a known alias (case-insensitive) to the full id", () => {
    saveAliases(["uuid-a", "uuid-b"]);
    expect(resolveId("cap-2")).toBe("uuid-b");
    expect(resolveId("CAP-1")).toBe("uuid-a");
  });

  it("resolveId passes non-alias input through unchanged", () => {
    expect(resolveId("8a2e6c1d-1111-2222-3333-444455556666")).toBe(
      "8a2e6c1d-1111-2222-3333-444455556666"
    );
  });

  it("resolveId throws with a next-action hint for an unknown alias", () => {
    saveAliases(["uuid-a"]);
    expect(() => resolveId("cap-9")).toThrow(/fb inbox/);
  });
});

describe("card aliases (c-N) alongside capture aliases", () => {
  it("saving card aliases does not clobber capture aliases (and vice versa)", () => {
    saveAliases(["cap-uuid-1"], "cap");
    saveAliases(["card-uuid-1", "card-uuid-2"], "c");
    expect(resolveId("cap-1")).toBe("cap-uuid-1");
    expect(resolveId("c-2")).toBe("card-uuid-2");
    saveAliases(["cap-uuid-9"], "cap"); // refresh captures
    expect(resolveId("c-1")).toBe("card-uuid-1"); // cards survive
    expect(resolveId("cap-1")).toBe("cap-uuid-9");
  });

  it("unknown card alias hints at fb list (not fb inbox)", () => {
    expect(() => resolveId("c-99")).toThrow(/fb list/);
  });
});

describe("parseDuration", () => {
  it.each([
    ["90", 90],
    ["90m", 90],
    ["2h", 120],
    ["3d", 4320],
    [" 45 m ", 45],
  ])("parses %s → %d minutes", (raw, want) => {
    expect(parseDuration(raw)).toBe(want);
  });

  it("rejects junk with a usage hint", () => {
    expect(() => parseDuration("tomorrow")).toThrow(/minutes/);
  });
});
