#!/usr/bin/env tsx
/**
 * Feature Development Workflow
 *
 * Orchestrates all 5 agents for new feature development:
 * 1. Researcher → finds best practices
 * 2. Architect → designs the solution
 * 3. UX/UI → reviews interface changes
 * 4. Engineer → implements the feature
 * 5. Tester → verifies functionality
 *
 * Usage:
 *   npx tsx workflows/feature.ts "Add dark mode toggle"
 */

import { runWorkflow } from "../orchestrator.js";

export function createFeaturePrompt(featureName: string): string {
  return `
## New Feature: ${featureName}

Execute this workflow with our agent team:

### Step 1: Research (Researcher Agent)
- Search for similar implementations in other apps
- Find best practices and common patterns
- Evaluate any libraries that might help
- Summarize findings with pros/cons

### Step 2: Architecture (Architect Agent)
- Design the feature based on research findings
- Identify files that need to be modified
- Consider state management implications
- Propose the implementation approach
- Flag any concerns (bundle size, security, etc.)

### Step 3: UX/UI Review (UX/UI Agent)
- Review proposed UI changes
- Ensure consistency with design system
- Check accessibility requirements
- Suggest improvements if needed

### Step 4: Implementation (Engineer Agent)
- Implement the approved design
- Follow existing code patterns
- Add TypeScript types
- Keep changes focused and minimal

### Step 5: Testing (Tester Agent)
- Run existing tests to check for regressions
- Write new tests for the feature
- Verify the feature works as expected
- Report coverage changes

---

**Important:**
- Present findings after each step
- Wait for approval before Step 4 (implementation)
- The Engineer should wait for Architect and UX/UI approval
`;
}

// CLI entry point
const featureName = process.argv.slice(2).join(" ");

if (!featureName) {
  console.log(`
Feature Development Workflow

Usage:
  npx tsx workflows/feature.ts "<feature name>"

Examples:
  npx tsx workflows/feature.ts "Add dark mode toggle"
  npx tsx workflows/feature.ts "Card recurring due dates"
  npx tsx workflows/feature.ts "Export to markdown"

This workflow coordinates all 5 agents:
  1. Researcher → Research best practices
  2. Architect  → Design the solution
  3. UX/UI      → Review interface
  4. Engineer   → Implement feature
  5. Tester     → Verify functionality
`);
  process.exit(0);
}

runWorkflow(createFeaturePrompt(featureName)).catch(console.error);
