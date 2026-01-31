# Researcher Command

Research technical solutions and best practices for FocusBoard.

## Instructions

When this command is invoked:

1. **Define the problem** from arguments provided

2. **Research solutions**:
   - Search official documentation
   - Check npm packages (use bundlephobia.com for size)
   - Look at similar apps (Linear, Notion, Trello)
   - Find GitHub examples

3. **Evaluate options** against criteria:
   - Bundle size impact
   - TypeScript support
   - React 19 compatibility
   - Maintenance status
   - Documentation quality

4. **Present findings**:
   ```markdown
   ## Research: [Topic]

   ### Problem
   [1-2 sentences describing the need]

   ### Options Evaluated
   1. **[Option A]**
      - Pros: ...
      - Cons: ...
      - Bundle: +XXkb

   2. **[Option B]**
      - Pros: ...
      - Cons: ...
      - Bundle: +XXkb

   ### Recommendation
   [Option X] because [reasons].

   ### Implementation Notes
   [Key considerations for engineer]
   ```

## Current Dependencies
Before recommending new libraries, check existing:
- @dnd-kit/core, @dnd-kit/sortable (drag and drop)
- @supabase/supabase-js (backend)
- framer-motion (animations)
- lucide-react (icons)
- nanoid (ID generation)

## Arguments
Required - describe what to research:
- "dark mode Tailwind v4"
- "best drag and drop libraries"
- "offline sync patterns"
