#!/usr/bin/env tsx
/**
 * Bug Fix Workflow
 *
 * Streamlined workflow for fixing bugs:
 * 1. Engineer → reproduces and locates the bug
 * 2. Architect → assesses broader implications
 * 3. Engineer → implements the fix
 * 4. Tester → verifies fix and checks regressions
 *
 * Usage:
 *   npx tsx workflows/bugfix.ts "Cards disappear when dragging to blocked column"
 */

import { runWorkflow } from "../orchestrator.js";

export function createBugfixPrompt(bugDescription: string): string {
  return `
## Bug Fix: ${bugDescription}

Execute this workflow:

### Step 1: Reproduce & Locate (Engineer Agent)
- Understand the bug from the description
- Search the codebase for relevant files
- Identify the root cause
- Document reproduction steps

### Step 2: Impact Assessment (Architect Agent)
- Review the proposed fix location
- Assess if fix has broader implications
- Check for related code that might need updating
- Approve approach or suggest alternatives

### Step 3: Implementation (Engineer Agent)
- Implement the fix
- Keep changes minimal and focused
- Add comments explaining the fix if non-obvious
- Update any related code identified by Architect

### Step 4: Verification (Tester Agent)
- Run the full test suite
- Add a test case for this specific bug
- Verify the fix works
- Check for regressions

---

**Important:**
- Keep changes as minimal as possible
- Wait for Architect approval before implementing
- The fix must not break existing tests
`;
}

// CLI entry point
const bugDescription = process.argv.slice(2).join(" ");

if (!bugDescription) {
  console.log(`
Bug Fix Workflow

Usage:
  npx tsx workflows/bugfix.ts "<bug description>"

Examples:
  npx tsx workflows/bugfix.ts "Cards disappear when dragging to blocked column"
  npx tsx workflows/bugfix.ts "Timeline panel shows wrong dates"
  npx tsx workflows/bugfix.ts "Undo doesn't restore deleted cards"

This workflow coordinates:
  1. Engineer  → Reproduce & locate
  2. Architect → Assess impact
  3. Engineer  → Implement fix
  4. Tester    → Verify & test
`);
  process.exit(0);
}

runWorkflow(createBugfixPrompt(bugDescription)).catch(console.error);
