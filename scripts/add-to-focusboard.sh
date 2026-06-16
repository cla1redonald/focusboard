#!/bin/bash

# Add to Focusboard - Mac Quick Action
# Select text anywhere, run this script, card gets created

# Webhook secret is read from an untracked local file — never commit secrets to this repo.
# Create it with: mkdir -p ~/.config/focusboard && printf '%s' '<secret>' > ~/.config/focusboard/webhook_secret
SECRET="$(cat "$HOME/.config/focusboard/webhook_secret" 2>/dev/null)"
WEBHOOK_URL="https://focusboard.roami.help/api/webhook/add-card"

# Get selected text (passed as argument from Automator)
TITLE="$1"

if [ -z "$TITLE" ]; then
  osascript -e 'display notification "No text selected" with title "Focusboard"'
  exit 1
fi

if [ -z "$SECRET" ]; then
  osascript -e 'display notification "Secret missing — create ~/.config/focusboard/webhook_secret" with title "Focusboard"'
  exit 1
fi

# Send to webhook
RESPONSE=$(curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$TITLE\", \"secret\": \"$SECRET\", \"source\": \"Mac\"}")

# Show notification
if echo "$RESPONSE" | grep -q '"success":true'; then
  osascript -e "display notification \"Added: $TITLE\" with title \"Focusboard ✓\""
else
  osascript -e 'display notification "Failed to add card" with title "Focusboard ✗"'
fi
