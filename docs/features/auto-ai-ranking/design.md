# Automatic AI Ranking

## Goal

Make Today feel smarter without adding another manual AI button. When the AI endpoint is configured, Today ranks focus recommendations automatically. When keys are missing or the request fails, the deterministic local ranking remains the source of truth.

## Shape

- Today opens with the existing local plan immediately.
- The view calls `/api/ai/daily-focus` through `useAI` once per modal open.
- Successful AI suggestions replace the displayed recommendation list and show the returned insight.
- Empty or failed AI responses keep the rules-ranked list in place.
- The API payload reuses the same card fields as the existing focus suggestion panel.

## Validation

- Component tests cover automatic AI invocation, AI-ranked display, and deterministic fallback.
- No new environment variable is required; existing AI endpoint behaviour controls availability.
