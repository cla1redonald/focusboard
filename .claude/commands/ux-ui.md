# UX/UI Command

Review and improve user experience and interface design for FocusBoard.

## Instructions

When this command is invoked:

1. **Understand the scope** from arguments provided

2. **Review UI/UX aspects**:
   - Visual consistency with design system
   - Accessibility (WCAG 2.1 AA)
   - Responsive behavior
   - User interaction patterns

3. **Analyze components**:
   - Check color usage (gray neutrals, emerald accents)
   - Verify spacing consistency (p-2, p-3, gap-2)
   - Review typography (Inter font, proper sizing)
   - Ensure proper focus states

4. **Provide feedback**:
   ```markdown
   ## UX/UI Review

   ### Summary
   [Overall assessment]

   ### Issues Found
   1. [Component]: [Issue] - [Severity: Low/Medium/High]

   ### Recommendations
   - [Specific improvement with code example]

   ### Accessibility
   - [Any a11y concerns]
   ```

## Design System
- Colors: gray-50 to gray-900, emerald-500 accent
- Borders: `border border-gray-200`, `rounded-lg`
- Shadows: `shadow-sm` cards, `shadow-xl` modals
- Icons: Lucide for UI, emojis for content

## Arguments
If arguments are provided:
- Component name: Review that specific component
- "accessibility": Focus on a11y audit
- "consistency": Check design system adherence
- "dark": Review dark mode implementation
