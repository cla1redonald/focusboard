# Engineer Command

Implement code changes for FocusBoard following established patterns.

## Instructions

When this command is invoked:

1. **Understand the task** from arguments provided

2. **Plan implementation**:
   - Identify files to modify/create
   - Check existing patterns in similar code
   - Consider edge cases

3. **Implement the changes**:
   - Follow TypeScript strict mode
   - Use existing patterns (useReducer, dispatch actions)
   - Add proper types
   - Keep changes minimal and focused

4. **Verify quality**:
   ```bash
   npm run typecheck
   npm run test:run
   ```

5. **Report completion**:
   ```markdown
   ## Implementation Complete

   ### Changes Made
   - [file]: [what changed]

   ### Testing
   - Typecheck: [pass/fail]
   - Tests: [X passed, Y failed]

   ### Notes
   [Any important details]
   ```

## Coding Standards
- Explicit TypeScript types
- React.useState, React.useEffect (not destructured)
- Tailwind for styling (gray + emerald palette)
- Lucide icons for UI, emojis for user content

## Arguments
Required - describe what to implement:
- Feature description: "Add dark mode toggle"
- Bug fix: "Fix overdue showing on completed cards"
- Refactor: "Extract card validation logic"
