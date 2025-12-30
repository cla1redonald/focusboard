# Architect Command

Provide architectural guidance and review for FocusBoard.

## Instructions

When this command is invoked:

1. **Understand the request** from arguments provided

2. **Analyze architecture implications**:
   - Impact on existing patterns (state, storage, components)
   - Bundle size considerations
   - Security concerns
   - Scalability implications

3. **Review relevant code**:
   - Check existing patterns in affected areas
   - Identify files that would need changes
   - Look for potential conflicts

4. **Provide recommendation**:
   ```markdown
   ## Architecture Review

   ### Summary
   [1-2 sentence overview]

   ### Affected Areas
   - [file/module]: [how it's affected]

   ### Recommended Approach
   [step-by-step approach]

   ### Concerns
   - [any risks or trade-offs]
   ```

## Decision Framework
- Simplicity over flexibility
- Mobile-first responsive design
- Bundle size awareness (~700KB current)
- Offline-first (localStorage is source of truth)

## Arguments
If arguments are provided:
- Feature name: Review architecture for that feature
- File path: Analyze that specific area
- "review": Full architecture health check
