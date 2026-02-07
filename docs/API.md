# Focusboard API

Focusboard provides APIs for adding cards from external automation tools and for capturing tasks from any channel with AI-powered parsing.

## Base URL

```
https://focusboard-claire-donalds-projects.vercel.app
```

## Authentication

Endpoints use one of two authentication methods:

- **Webhook secret** -- A shared secret passed in the request body (used by the Add Card and Capture endpoints for external channels)
- **Bearer token** -- A Supabase access token passed in the `Authorization` header (used by the Capture endpoint for in-app calls and by the Feedback endpoint)

## Endpoints

### Add Card

Add a new card to the board.

**Endpoint:** `POST /api/webhook/add-card`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Card title (will be trimmed) |
| `secret` | string | Yes | Webhook secret for authentication |
| `column` | string | No | Target column ID (default: `"backlog"`) |
| `source` | string | No | Source label for the note (default: `"Webhook"`) |

**Default Columns:**

| ID | Title |
|----|-------|
| `backlog` | Backlog |
| `design` | Design & Planning |
| `todo` | To Do |
| `doing` | Doing |
| `blocked` | Blocked |
| `done` | Done |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Added \"Buy coffee\" to backlog",
  "cardId": "abc123xyz"
}
```

**Error Responses:**

| Status | Response | Cause |
|--------|----------|-------|
| 400 | `{"error": "Title is required"}` | Missing or empty title |
| 401 | `{"error": "Invalid secret"}` | Wrong or missing secret |
| 405 | `{"error": "Method not allowed"}` | Not a POST request |
| 500 | `{"error": "..."}` | Server configuration or database error |

---

## Example Requests

### cURL

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Buy more coffee",
    "secret": "your-webhook-secret",
    "source": "Terminal"
  }'
```

### Python

```python
import requests

response = requests.post(
    "https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card",
    json={
        "title": "Review quarterly report",
        "secret": "your-webhook-secret",
        "column": "todo",
        "source": "Python Script"
    }
)
print(response.json())
```

### JavaScript (Node.js)

```javascript
const response = await fetch(
  "https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Finish documentation",
      secret: "your-webhook-secret",
      source: "Node Script"
    })
  }
);
const data = await response.json();
console.log(data);
```

### Apple Shortcuts

1. Create a new Shortcut
2. Add action: **Get Contents of URL**
3. Configure:
   - **URL:** `https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card`
   - **Method:** POST
   - **Headers:** `Content-Type: application/json`
   - **Request Body:** JSON
   - Add fields (lowercase keys required):
     - `title`: Shortcut Input or text
     - `secret`: your webhook secret
     - `source`: "Shortcuts" (optional)

**Important:** JSON keys must be lowercase (`title`, `secret`, `source`), not capitalized.

### Zapier

1. Create a new Zap
2. Add action: **Webhooks by Zapier > POST**
3. Configure:
   - **URL:** `https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card`
   - **Payload Type:** json
   - **Data:**
     - `title`: (your trigger data)
     - `secret`: your-webhook-secret
     - `source`: "Zapier"

---

### Capture Task

Send raw content from any channel. The AI pipeline parses it into structured card(s) and either auto-adds them to the board (confidence >= 0.8) or queues them in the Capture Inbox for review.

**Endpoint:** `POST /api/capture`

**Authentication:** Webhook secret (external channels) OR Bearer token (in-app).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Raw text to capture (max 10,000 characters) |
| `source` | string | No | Channel identifier (default: `"in_app"`) |
| `metadata` | object | No | Source-specific context (default: `{}`) |
| `secret` | string | Conditional | Webhook secret -- required when not using Bearer auth |
| `user_id` | string | Conditional | Supabase user UUID -- required when using webhook secret auth |

**Valid `source` values:** `email`, `slack`, `shortcut`, `browser`, `whatsapp`, `in_app`

**Success Response (200):**

```json
{
  "success": true,
  "message": "Captured from slack",
  "captureId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Error Responses:**

| Status | Response | Cause |
|--------|----------|-------|
| 400 | `{"error": "Content is required"}` | Missing or empty content |
| 400 | `{"error": "User ID required"}` | No user_id and no FOCUSBOARD_USER_ID fallback |
| 401 | `{"error": "Invalid secret"}` | Wrong or missing webhook secret |
| 401 | `{"error": "Unauthorized"}` | Missing or invalid Bearer token |
| 405 | `{"error": "Method not allowed"}` | Not a POST request |
| 500 | `{"error": "Failed to save capture"}` | Database insert failed |
| 500 | `{"error": "Internal server error"}` | Unexpected server error |

**Processing:** After a successful capture, the endpoint fires an asynchronous request to `POST /api/capture/process` to run AI extraction. The caller does not need to wait for processing to complete.

#### Example Requests

**Slack (via Zapier webhook):**

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/capture \
  -H "Content-Type: application/json" \
  -d '{
    "content": "We need to redesign the onboarding flow before launch",
    "source": "slack",
    "metadata": {"channel": "#product", "sender": "alice"},
    "secret": "your-webhook-secret",
    "user_id": "your-user-uuid"
  }'
```

**Email (via Zapier webhook):**

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/capture \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Subject: Q3 budget review\n\nPlease review the attached spreadsheet and send comments by Friday.",
    "source": "email",
    "metadata": {"from": "finance@example.com", "subject": "Q3 budget review"},
    "secret": "your-webhook-secret",
    "user_id": "your-user-uuid"
  }'
```

**Browser extension:**

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/capture \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Interesting approach to state management in this article",
    "source": "browser",
    "metadata": {"url": "https://example.com/article", "pageTitle": "Modern State Management"},
    "secret": "your-webhook-secret",
    "user_id": "your-user-uuid"
  }'
```

**Apple Shortcuts / iOS Share Sheet:**

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/capture \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Pick up groceries: milk, eggs, bread",
    "source": "shortcut",
    "secret": "your-webhook-secret",
    "user_id": "your-user-uuid"
  }'
```

**In-app (Bearer auth):**

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/capture \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <supabase_access_token>" \
  -d '{
    "content": "Set up CI pipeline for staging environment",
    "source": "in_app"
  }'
```

---

### Process Capture (Internal)

Runs the AI extraction pipeline on a queued capture item. This endpoint is called automatically by `POST /api/capture` and is not intended to be called directly by external clients.

**Endpoint:** `POST /api/capture/process`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `capture_id` | string (UUID) | Yes | ID of the capture_queue row to process |
| `user_id` | string (UUID) | Yes | Supabase user UUID |

**Processing Pipeline:**

1. Marks the capture_queue row as `processing`
2. Fetches the raw content and the user's current board state for context
3. Sends the content to Claude Haiku for structured extraction
4. Receives one or more parsed cards, each with a confidence score (0.0--1.0)
5. Calculates average confidence across all extracted cards
6. If average confidence >= 0.8: sets status to `auto_added` and writes cards directly to the board
7. If average confidence < 0.8: sets status to `ready` for manual review in the Capture Inbox

**Confidence Scoring Guide:**

| Range | Meaning | Outcome |
|-------|---------|---------|
| 0.9+ | Clear, unambiguous single task | Auto-added to board |
| 0.7--0.9 | Reasonable extraction, some ambiguity | Depends on average |
| Below 0.7 | Vague content, unclear action items | Queued for review |

**Success Response (200):**

```json
{
  "success": true,
  "status": "auto_added",
  "confidence": 0.92,
  "cardCount": 1
}
```

**Error Responses:**

| Status | Response | Cause |
|--------|----------|-------|
| 400 | `{"error": "capture_id and user_id required"}` | Missing required fields |
| 404 | `{"error": "Capture item not found"}` | Invalid capture_id |
| 405 | `{"error": "Method not allowed"}` | Not a POST request |
| 500 | `{"error": "ANTHROPIC_API_KEY not configured"}` | Missing API key |
| 500 | `{"error": "Processing failed"}` | AI extraction or database error |

---

### Submit Feedback

Submit a bug report or feature request. Requires user authentication (logged in).

**Endpoint:** `POST /api/feedback/submit`

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <supabase_access_token>` |
| `Content-Type` | Yes | `application/json` |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Either `"bug"` or `"feature"` |
| `title` | string | Yes | Feedback title |
| `description` | string | No | Detailed description |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Thank you for your feedback!"
}
```

**Error Responses:**

| Status | Response | Cause |
|--------|----------|-------|
| 400 | `{"error": "Title is required"}` | Missing or empty title |
| 400 | `{"error": "Invalid type..."}` | Type must be "bug" or "feature" |
| 401 | `{"error": "Authentication required"}` | Missing or invalid auth token |
| 500 | `{"error": "FEEDBACK_OWNER_USER_ID not configured"}` | Missing env variable |
| 500 | `{"error": "..."}` | Server configuration error |

**Notes:**

- Feedback is automatically added to the owner's backlog (configured via `FEEDBACK_OWNER_USER_ID`)
- Cards are tagged with "Bug Report" or "Feature Request" tags
- The submitter's email and timestamp are recorded in the card notes

---

## Card Data Model

Cards created via webhook have the following structure:

```typescript
{
  id: string;           // Auto-generated unique ID (nanoid)
  column: string;       // Target column ID
  title: string;        // Card title
  order: 0;             // Placed at top of column
  createdAt: string;    // ISO timestamp
  updatedAt: string;    // ISO timestamp
  tags: [];             // Empty array
  checklist: [];        // Empty array
  notes?: string;       // "Added from {source}" if source provided
  columnHistory: [{     // Movement history
    from: null,
    to: column,
    at: timestamp
  }];
  // The following fields exist on the Card type but are NOT set by the webhook:
  // archivedAt?: string;    // Set when card is archived (manually or auto-archive)
  // completedAt?: string;   // Set when card moves to a terminal column
  // links?: CardLink[];     // Multiple links with labels
  // attachments?: Attachment[]; // File attachments
}
```

---

## Environment Variables

The API endpoints require these Vercel environment variables:

| Variable | Description |
|----------|-------------|
| `WEBHOOK_SECRET` | Shared secret for webhook and capture authentication |
| `FOCUSBOARD_USER_ID` | Your Supabase user UUID (fallback for webhook/capture endpoints) |
| `FEEDBACK_OWNER_USER_ID` | Your Supabase user UUID (receives feedback submissions) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) |
| `ANTHROPIC_API_KEY` | Anthropic API key (required for Capture Hub AI processing) |

**Finding your User ID:**

1. Go to your Supabase dashboard
2. Navigate to Authentication > Users
3. Find your account and copy the UUID from the "UID" column

See [SUPABASE.md](./SUPABASE.md) for database setup.

---

## Extending the API

To add new endpoints, create files in the `api/` directory:

```
api/
├── capture/
│   ├── index.ts       # POST /api/capture
│   └── process.ts     # POST /api/capture/process
├── feedback/
│   └── submit.ts      # POST /api/feedback/submit
└── webhook/
    └── add-card.ts    # POST /api/webhook/add-card
```

Each file exports a default handler function:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Handle request
}
```

**Important:** API route files must be self-contained. Do not import from `src/` directory as this breaks Vercel's serverless function bundling. Inline all types and utilities.

---

## Troubleshooting

### Cards not appearing in the app

1. Check that cloud sync is enabled (Supabase credentials configured)
2. Verify RLS policies are set up correctly
3. Refresh the app - cards sync on page load

### 404 NOT_FOUND errors

1. Ensure deployment protection is disabled or bypassed
2. Check that the API file exists in `api/webhook/add-card.ts`
3. Verify the URL path matches exactly

### 401 Invalid secret

1. Verify `WEBHOOK_SECRET` is set in Vercel environment variables
2. Ensure the secret in your request matches exactly (case-sensitive)
3. Use lowercase JSON keys in requests

### 500 Server errors

1. Check Vercel function logs: `vercel logs --prod`
2. Verify all required environment variables are set
3. Confirm Supabase connection is working

### Captured tasks not appearing

1. Check that the `capture_queue` table exists (see [SUPABASE.md](./SUPABASE.md))
2. Verify `ANTHROPIC_API_KEY` is set in Vercel environment variables
3. Confirm real-time is enabled for `capture_queue` (see [SUPABASE.md](./SUPABASE.md))
4. If auto-add is not working, check that confidence threshold (0.8) is being met -- lower-confidence items appear in the Capture Inbox instead
