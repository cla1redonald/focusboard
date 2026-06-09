// Capture Hub types — shared between client and referenced by API endpoints

export type CaptureSource = 'email' | 'slack' | 'shortcut' | 'browser' | 'whatsapp' | 'in_app';

export type CaptureStatus = 'pending' | 'processing' | 'ready' | 'auto_added' | 'dismissed';

// The triage set — statuses that mean "awaiting triage" on EVERY inbox surface
// (web Capture Inbox and the API/CLI inbox). One definition so the surfaces cannot
// drift: the API filtering on 'pending' alone while the pipeline promoted captures
// to 'ready' is exactly the bug this prevents. 'auto_added' is deliberately not
// here — those are already on the board.
export const TRIAGE_STATUSES = ['pending', 'processing', 'ready'] as const satisfies readonly CaptureStatus[];

export type ParsedCaptureCard = {
  title: string;
  notes?: string;
  tags?: string[];        // Tag IDs from existing board tags
  swimlane?: 'work' | 'personal';
  suggestedColumn?: string; // Column ID
  dueDate?: string;        // ISO date
  confidence: number;      // 0.0 - 1.0
  duplicateOf?: string;    // Card ID if duplicate detected
  relatedTo?: string[];    // Card IDs for relationship suggestions
};

export type CaptureQueueItem = {
  id: string;
  user_id: string;
  status: CaptureStatus;
  confidence: number | null;
  source: CaptureSource;
  raw_content: string;
  raw_metadata: Record<string, unknown>;
  parsed_cards: ParsedCaptureCard[] | null;
  created_at: string;
  processed_at: string | null;
  snoozed_until: string | null;
};

// Source display config for the UI
export const SOURCE_CONFIG: Record<CaptureSource, { label: string; borderColor: string; darkBorderColor: string; icon: string }> = {
  slack:    { label: 'Slack',    borderColor: 'border-l-emerald-500', darkBorderColor: 'dark:border-l-emerald-400', icon: '💬' },
  email:    { label: 'Email',    borderColor: 'border-l-blue-500',    darkBorderColor: 'dark:border-l-blue-400',    icon: '📧' },
  browser:  { label: 'Browser',  borderColor: 'border-l-sky-500',     darkBorderColor: 'dark:border-l-sky-400',     icon: '🌐' },
  shortcut: { label: 'Shortcut', borderColor: 'border-l-amber-500',   darkBorderColor: 'dark:border-l-amber-400',   icon: '⚡' },
  whatsapp: { label: 'WhatsApp', borderColor: 'border-l-emerald-300', darkBorderColor: 'dark:border-l-emerald-300', icon: '📱' },
  in_app:   { label: 'In-App',   borderColor: 'border-l-gray-400',    darkBorderColor: 'dark:border-l-gray-500',    icon: '📋' },
};
