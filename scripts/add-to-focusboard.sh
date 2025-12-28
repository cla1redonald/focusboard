#!/bin/bash

# Add to Focusboard - Mac Quick Action
# Select text anywhere, run this script, card gets created

# Your webhook secret (already configured)
SECRET="a0e9c519d5464330ef2570e4c546aee22f5f651dff1732265350e51372dc40b5"
WEBHOOK_URL="https://focusboard.vercel.app/api/webhook/add-card"

# Get selected text (passed as argument from Automator)
TITLE="$1"

if [ -z "$TITLE" ]; then
  osascript -e 'display notification "No text selected" with title "Focusboard"'
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
