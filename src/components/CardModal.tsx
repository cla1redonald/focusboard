import React from "react";
import { X, Trash2, CheckCircle, Sparkles, Loader2, Upload, Download, FileText, AlertCircle, GripVertical, Plus, Link, Archive } from "lucide-react";
import type { Card, CardLink, RelationType, Tag, TagCategory, Attachment } from "../app/types";
import { nanoid } from "nanoid";
import { RelationshipPicker, RelationshipBadge } from "./RelationshipPicker";
import { TAG_COLOR_PALETTE, DEFAULT_SWIMLANES } from "../app/constants";
import { UnsplashPicker } from "./UnsplashPicker";
import { useAI } from "../app/useAI";
import { useAttachments, isImageType, formatFileSize } from "../app/useAttachments";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Checklist types and components
type ChecklistItem = { id: string; text: string; done: boolean };

function ChecklistSection({
  checklist,
  onUpdate,
}: {
  checklist: ChecklistItem[];
  onUpdate: (checklist: ChecklistItem[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = checklist.findIndex((item) => item.id === active.id);
      const newIndex = checklist.findIndex((item) => item.id === over.id);
      onUpdate(arrayMove(checklist, oldIndex, newIndex));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number, itemId: string) => {
    const item = checklist.find((x) => x.id === itemId);
    if (e.key === "Enter") {
      e.preventDefault();
      const newId = nanoid();
      const newChecklist = [
        ...checklist.slice(0, idx + 1),
        { id: newId, text: "", done: false },
        ...checklist.slice(idx + 1),
      ];
      onUpdate(newChecklist);
      setTimeout(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>('[data-checklist-input]');
        inputs[idx + 1]?.focus();
      }, 0);
    } else if (e.key === "Backspace" && item?.text === "") {
      e.preventDefault();
      if (checklist.length > 1) {
        onUpdate(checklist.filter((x) => x.id !== itemId));
        setTimeout(() => {
          const inputs = document.querySelectorAll<HTMLInputElement>('[data-checklist-input]');
          inputs[Math.max(0, idx - 1)]?.focus();
        }, 0);
      }
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-500 dark:text-gray-400">Checklist</label>
        <span className="text-[10px] text-gray-400">Drag to reorder • Enter to add</span>
      </div>
      <div className="mt-2 space-y-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={checklist.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            {checklist.map((item, idx) => (
              <SortableChecklistItem
                key={item.id}
                item={item}
                onToggle={(done) =>
                  onUpdate(checklist.map((x) => (x.id === item.id ? { ...x, done } : x)))
                }
                onTextChange={(text) =>
                  onUpdate(checklist.map((x) => (x.id === item.id ? { ...x, text } : x)))
                }
                onKeyDown={(e) => handleKeyDown(e, idx, item.id)}
                onDelete={() => onUpdate(checklist.filter((x) => x.id !== item.id))}
              />
            ))}
          </SortableContext>
        </DndContext>
        {/* Add new item input */}
        <div className="flex items-center gap-2 pt-1">
          <div className="w-4" /> {/* Spacer for drag handle */}
          <div className="h-4 w-4" /> {/* Spacer for checkbox */}
          <input
            placeholder="+ Add item..."
            className="flex-1 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-gray-600 focus:border-solid"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const input = e.target as HTMLInputElement;
                const text = input.value.trim();
                if (text) {
                  onUpdate([...checklist, { id: nanoid(), text, done: false }]);
                  input.value = "";
                }
              }
            }}
            onBlur={(e) => {
              const text = e.target.value.trim();
              if (text) {
                onUpdate([...checklist, { id: nanoid(), text, done: false }]);
                e.target.value = "";
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

// Sortable checklist item component

function SortableChecklistItem({
  item,
  onToggle,
  onTextChange,
  onKeyDown,
  onDelete,
}: {
  item: ChecklistItem;
  onToggle: (done: boolean) => void;
  onTextChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 ${isDragging ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 accent-emerald-600"
      />
      <input
        value={item.text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        data-checklist-input
        placeholder="Type here..."
        className="flex-1 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500"
      />
      <button
        onClick={onDelete}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        ✕
      </button>
    </div>
  );
}

// Extended emoji palette organized by category
const EMOJI_CHOICES = [
  // Status
  "✨", "✅", "⚡", "🔥", "🚧", "⛔", "🎯", "🔍",
  // Work
  "📝", "📌", "📎", "🛠️", "💡", "🧠", "🧩", "🎨",
  // Objects
  "📱", "💻", "📊", "📈", "🔗", "📧", "💬", "🔔",
  // Nature & Fun
  "⭐", "💎", "🌟", "🏆", "🎉", "💪", "🚀", "🌈",
];

const RECENT_EMOJIS_KEY = "focusboard:recent_emojis";
const MAX_RECENT_EMOJIS = 8;

function loadRecentEmojis(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji: string): string[] {
  const recent = loadRecentEmojis();
  const updated = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJIS);
  localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(updated));
  return updated;
}

type Props = {
  open: boolean;
  card: Card | null;
  allCards?: Card[];

  tags?: Tag[];
  tagCategories?: TagCategory[];
  userId?: string | null;
  onClose: () => void;
  onSave: (card: Card) => void;
  onDelete: (id: string) => void;
  onMarkComplete?: (id: string) => void;
  onArchive?: (id: string) => void;
  isCompleted?: boolean;
  onAddRelation?: (cardId: string, targetCardId: string, relationType: RelationType) => void;
  onRemoveRelation?: (cardId: string, relationId: string) => void;
  onAddTag?: (tag: Omit<Tag, "id">) => void;
};

export function CardModal({
  open,
  card,
  allCards,
  tags = [],
  tagCategories = [],
  userId,
  onClose,
  onSave,
  onDelete,
  onMarkComplete,
  onArchive,
  isCompleted = false,
  onAddRelation,
  onRemoveRelation,
  onAddTag,
}: Props) {
  const [draft, setDraft] = React.useState<Card | null>(card);
  const [showRelationPicker, setShowRelationPicker] = React.useState(false);
  const [showAddTag, setShowAddTag] = React.useState(false);
  const [newTagName, setNewTagName] = React.useState("");
  const [newTagColor, setNewTagColor] = React.useState(TAG_COLOR_PALETTE[0]);
  const [showUnsplashPicker, setShowUnsplashPicker] = React.useState(false);
  const [showUrlInput, setShowUrlInput] = React.useState(false);
  const [customUrl, setCustomUrl] = React.useState("");
  const [recentEmojis, setRecentEmojis] = React.useState<string[]>(() => loadRecentEmojis());
  const emojiInputRef = React.useRef<HTMLInputElement>(null);

  // AI task breakdown
  const { breakdownTask, isLoading: aiLoading } = useAI();
  const [aiSuggestions, setAiSuggestions] = React.useState<{ text: string; estimatedEffort?: string }[]>([]);
  const [aiSuggestion, setAiSuggestion] = React.useState<string | undefined>();

  // File attachments
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [signedUrls, setSignedUrls] = React.useState<Record<string, string>>({});
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const {
    uploadFile,
    deleteFile,
    getSignedUrl,
    uploads,
    isConfigured: isStorageConfigured
  } = useAttachments(userId ?? null, draft?.id ?? "");

  const selectEmoji = (emoji: string) => {
    update({ icon: emoji });
    setRecentEmojis(saveRecentEmoji(emoji));
  };

  React.useEffect(() => {
    setDraft(card);
    setShowRelationPicker(false);
    setShowAddTag(false);
    setNewTagName("");
    setNewTagColor(TAG_COLOR_PALETTE[0]);
    setShowUnsplashPicker(false);
    setShowUrlInput(false);
    setCustomUrl("");
    setAiSuggestions([]);
    setAiSuggestion(undefined);
    setSignedUrls({});
    setUploadError(null);
  }, [card]);

  // Load signed URLs for existing attachments
  React.useEffect(() => {
    if (!draft?.attachments?.length) return;
    let isMounted = true;

    const loadUrls = async () => {
      const urls: Record<string, string> = {};
      for (const att of draft.attachments!) {
        // Check isMounted to prevent update after unmount (race condition fix)
        if (!isMounted) return;
        if (!signedUrls[att.id]) {
          const url = await getSignedUrl(att.storagePath);
          if (url) urls[att.id] = url;
        }
      }
      if (isMounted && Object.keys(urls).length > 0) {
        setSignedUrls((prev) => ({ ...prev, ...urls }));
      }
    };
    void loadUrls();
    return () => { isMounted = false; };
  }, [draft?.attachments]); // Removed getSignedUrl - it's stable

  // File upload handlers
  const handleFiles = async (files: FileList | null) => {
    if (!files || !draft) return;
    setUploadError(null);

    for (const file of Array.from(files)) {
      try {
        const attachment = await uploadFile(file);
        if (attachment) {
          update({
            attachments: [...(draft.attachments ?? []), attachment]
          });
          // Get signed URL for the new attachment
          const url = await getSignedUrl(attachment.storagePath);
          if (url) {
            setSignedUrls((prev) => ({ ...prev, [attachment.id]: url }));
          }
        }
      } catch (error) {
        setUploadError((error as Error).message);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  const handleDeleteAttachment = async (attachment: Attachment) => {
    if (!draft) return;
    await deleteFile(attachment.storagePath);
    update({
      attachments: draft.attachments?.filter((a) => a.id !== attachment.id) ?? []
    });
    setSignedUrls((prev) => {
      const updated = { ...prev };
      delete updated[attachment.id];
      return updated;
    });
  };

  if (!open || !draft) return null;

  const update = (patch: Partial<Card>) => setDraft({ ...draft, ...patch });

  const handleAddRelation = (targetCardId: string, relationType: RelationType) => {
    if (onAddRelation) {
      onAddRelation(draft.id, targetCardId, relationType);
    }
    setShowRelationPicker(false);
  };

  const handleRemoveRelation = (relationId: string) => {
    if (onRemoveRelation) {
      onRemoveRelation(draft.id, relationId);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-[720px] flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
        {/* Fixed Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 dark:border-gray-700 px-4 py-3 sm:px-6 sm:py-4">
          <div className="text-lg font-semibold text-gray-900 dark:text-white sm:text-xl">Edit card</div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Title</label>
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="mt-1.5 w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Icon (emoji)</label>
            <div className="mt-1.5 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  ref={emojiInputRef}
                  value={draft.icon ?? ""}
                  onChange={(e) => update({ icon: e.target.value })}
                  placeholder="Type or paste emoji"
                  className="w-32 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-center text-lg text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
                {draft.icon && (
                  <button
                    type="button"
                    onClick={() => update({ icon: undefined })}
                    className="rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    Clear
                  </button>
                )}
                <span className="text-[10px] text-gray-400">
                  Tip: Press {navigator.platform.includes("Mac") ? "⌘+Ctrl+Space" : "Win+."} for full emoji keyboard
                </span>
              </div>
              {/* Recent emojis */}
              {recentEmojis.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">Recently used</div>
                  <div className="flex flex-wrap gap-1">
                    {recentEmojis.map((emoji) => (
                      <button
                        key={`recent-${emoji}`}
                        type="button"
                        onClick={() => selectEmoji(emoji)}
                        className={`rounded-md border px-2 py-1 text-base transition ${
                          draft.icon === emoji
                            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30"
                            : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500"
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* All emojis */}
              <div className="flex flex-wrap gap-1">
                {EMOJI_CHOICES.filter((e) => !recentEmojis.includes(e)).map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => selectEmoji(emoji)}
                    className={`rounded-md border px-2 py-1 text-base transition ${
                      draft.icon === emoji
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30"
                        : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Notes</label>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              className="mt-1.5 w-full min-h-[90px] rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          {/* Links Section */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Links</label>
              <button
                type="button"
                onClick={() => {
                  const newLink: CardLink = { id: nanoid(), url: "", label: "" };
                  update({ links: [...(draft.links ?? []), newLink] });
                }}
                className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700"
              >
                <Plus size={12} />
                Add link
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {(draft.links ?? []).map((link, idx) => (
                <div key={link.id} className="flex items-start gap-2">
                  <div className="mt-2.5 text-gray-400">
                    <Link size={14} />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <input
                      value={link.url}
                      onChange={(e) => {
                        const newLinks = [...(draft.links ?? [])];
                        newLinks[idx] = { ...link, url: e.target.value };
                        update({ links: newLinks });
                      }}
                      placeholder="https://..."
                      className="w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                    <input
                      value={link.label ?? ""}
                      onChange={(e) => {
                        const newLinks = [...(draft.links ?? [])];
                        newLinks[idx] = { ...link, label: e.target.value || undefined };
                        update({ links: newLinks });
                      }}
                      placeholder="Label (optional)"
                      className="w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newLinks = (draft.links ?? []).filter((_, i) => i !== idx);
                      update({ links: newLinks });
                    }}
                    className="mt-2 text-gray-400 hover:text-red-500"
                    title="Remove link"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              {(draft.links ?? []).length === 0 && (
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  No links yet. Click &quot;Add link&quot; to add one.
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Due date</label>
            <input
              type="date"
              value={draft.dueDate ? draft.dueDate.slice(0, 10) : ""}
              onChange={(e) =>
                update({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })
              }
              onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              className="mt-1.5 w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Swimlane</label>
            <div className="mt-1.5 flex gap-2">
              {DEFAULT_SWIMLANES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => update({ swimlane: s.id })}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                    (draft.swimlane ?? "work") === s.id
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30"
                      : "border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500"
                  }`}
                  style={{
                    borderColor: (draft.swimlane ?? "work") === s.id ? s.color : undefined,
                    backgroundColor: (draft.swimlane ?? "work") === s.id ? `${s.color}15` : undefined,
                  }}
                >
                  <span className="text-base">{s.icon}</span>
                  <span className="text-gray-900 dark:text-white">{s.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Card Background */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">Card Background</label>
              {draft.backgroundImage && (
                <button
                  type="button"
                  onClick={() => update({ backgroundImage: undefined })}
                  className="text-xs text-rose-600 hover:text-rose-700"
                >
                  Remove
                </button>
              )}
            </div>

            {draft.backgroundImage ? (
              <div className="mt-2">
                <div className="relative aspect-video w-full max-w-[200px] overflow-hidden rounded-lg border border-gray-200">
                  <img
                    src={draft.backgroundImage}
                    alt="Card background"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowUnsplashPicker(true); setShowUrlInput(false); }}
                    className="text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    Search Unsplash
                  </button>
                  <span className="text-xs text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => { setShowUrlInput(true); setShowUnsplashPicker(false); }}
                    className="text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    Paste URL
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowUnsplashPicker(true); setShowUrlInput(false); }}
                  className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  Search Unsplash
                </button>
                <button
                  type="button"
                  onClick={() => { setShowUrlInput(true); setShowUnsplashPicker(false); }}
                  className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  Paste URL
                </button>
              </div>
            )}

            {/* URL Input */}
            {showUrlInput && (
              <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Paste an image URL (Google Drive, Dropbox, etc.)
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customUrl.trim()) {
                        update({ backgroundImage: customUrl.trim() });
                        setShowUrlInput(false);
                        setCustomUrl("");
                      }
                    }}
                    disabled={!customUrl.trim()}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowUrlInput(false); setCustomUrl(""); }}
                    className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-gray-400">
                  Tip: For Google Drive, use "Get link" → "Anyone with the link" and change /file/d/ID/view to /uc?id=ID
                </div>
              </div>
            )}

            {showUnsplashPicker && (
              <div className="mt-3">
                <UnsplashPicker
                  onSelect={(imageUrl) => {
                    update({ backgroundImage: imageUrl });
                    setShowUnsplashPicker(false);
                  }}
                  onCancel={() => setShowUnsplashPicker(false)}
                />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">Tags</label>
              {onAddTag && (
                <button
                  type="button"
                  onClick={() => setShowAddTag(!showAddTag)}
                  className="text-xs text-emerald-600 hover:text-emerald-700"
                >
                  {showAddTag ? "Cancel" : "+ Add custom tag"}
                </button>
              )}
            </div>

            {/* Add Tag Form */}
            {showAddTag && onAddTag && (
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex gap-2">
                  <input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Tag name"
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newTagName.trim()) {
                        onAddTag({
                          name: newTagName.trim(),
                          color: newTagColor,
                          categoryId: "custom",
                        });
                        // Add the new tag to draft immediately (it will get the real ID from state)
                        setNewTagName("");
                        setShowAddTag(false);
                      }
                    }}
                    disabled={!newTagName.trim()}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {TAG_COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewTagColor(color)}
                      className={`h-6 w-6 rounded-full transition-transform ${
                        newTagColor === color ? "scale-110 ring-2 ring-offset-1 ring-emerald-600" : "hover:scale-105"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Tag Categories */}
            {tags.length > 0 ? (
              <div className="mt-2 space-y-3">
                {tagCategories
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((category) => {
                    const categoryTags = tags.filter((t) => t.categoryId === category.id);
                    if (categoryTags.length === 0) return null;
                    return (
                      <div key={category.id}>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-1.5">
                          {category.name}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {categoryTags.map((tag) => {
                            const isSelected = (draft.tags ?? []).includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  const currentTags = draft.tags ?? [];
                                  update({
                                    tags: isSelected
                                      ? currentTags.filter((t) => t !== tag.id)
                                      : [...currentTags, tag.id],
                                  });
                                }}
                                className={`
                                  inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
                                  transition-all duration-150
                                  ${isSelected
                                    ? "ring-2 ring-offset-1"
                                    : "opacity-60 hover:opacity-100"
                                  }
                                `}
                                style={{
                                  backgroundColor: `${tag.color}20`,
                                  color: tag.color,
                                  ...(isSelected ? { ringColor: tag.color } : {}),
                                }}
                              >
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: tag.color }}
                                />
                                {tag.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                {/* Custom/Uncategorized Tags */}
                {(() => {
                  const customTags = tags.filter((t) => t.categoryId === "custom" || !tagCategories.some((c) => c.id === t.categoryId));
                  if (customTags.length === 0) return null;
                  return (
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-1.5">
                        Custom
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {customTags.map((tag) => {
                          const isSelected = (draft.tags ?? []).includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                const currentTags = draft.tags ?? [];
                                update({
                                  tags: isSelected
                                    ? currentTags.filter((t) => t !== tag.id)
                                    : [...currentTags, tag.id],
                                });
                              }}
                              className={`
                                inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
                                transition-all duration-150
                                ${isSelected
                                  ? "ring-2 ring-offset-1"
                                  : "opacity-60 hover:opacity-100"
                                }
                              `}
                              style={{
                                backgroundColor: `${tag.color}20`,
                                color: tag.color,
                                ...(isSelected ? { ringColor: tag.color } : {}),
                              }}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="mt-2 text-xs text-gray-400">
                No tags yet. Click &quot;+ Add custom tag&quot; to create one.
              </div>
            )}
          </div>

          <ChecklistSection
            checklist={draft.checklist ?? []}
            onUpdate={(newChecklist) => update({ checklist: newChecklist })}
          />

          {/* AI Task Breakdown */}
          <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  const existingItems = (draft.checklist ?? []).map((item) => item.text);
                  const result = await breakdownTask(draft.title, {
                    notes: draft.notes,
                    tags: draft.tags,
                    existingChecklist: existingItems,
                  });
                  if (result) {
                    setAiSuggestions(result.subtasks);
                    setAiSuggestion(result.suggestion);
                  }
                }}
                disabled={aiLoading}
                className="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
              >
                {aiLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Breaking down...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Break down with AI
                  </>
                )}
              </button>

              {aiSuggestions.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      AI Suggestions
                    </span>
                    <button
                      onClick={() => {
                        const newItems = aiSuggestions.map((s) => ({
                          id: nanoid(),
                          text: s.text,
                          done: false,
                        }));
                        update({ checklist: [...(draft.checklist ?? []), ...newItems] });
                        setAiSuggestions([]);
                        setAiSuggestion(undefined);
                      }}
                      className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                    >
                      Add all
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {aiSuggestions.map((suggestion, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-sm dark:bg-gray-800"
                      >
                        <button
                          onClick={() => {
                            update({
                              checklist: [
                                ...(draft.checklist ?? []),
                                { id: nanoid(), text: suggestion.text, done: false },
                              ],
                            });
                            setAiSuggestions(aiSuggestions.filter((_, i) => i !== idx));
                          }}
                          className="text-emerald-500 hover:text-emerald-600"
                          title="Add to checklist"
                        >
                          +
                        </button>
                        <span className="flex-1 text-gray-700 dark:text-gray-300">{suggestion.text}</span>
                        {suggestion.estimatedEffort && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            suggestion.estimatedEffort === "quick"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : suggestion.estimatedEffort === "medium"
                              ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}>
                            {suggestion.estimatedEffort}
                          </span>
                        )}
                        <button
                          onClick={() => setAiSuggestions(aiSuggestions.filter((_, i) => i !== idx))}
                          className="text-gray-400 hover:text-gray-600"
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {aiSuggestion && (
                    <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                      💡 {aiSuggestion}
                    </div>
                  )}
                </div>
              )}
            </div>

          {(draft.blockedReason ?? draft.lastOverrideReason) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
              {draft.blockedReason && <div>Blocked: {draft.blockedReason}</div>}
              {draft.lastOverrideReason && (
                <div className="mt-1">
                  Override: {draft.lastOverrideReason}
                </div>
              )}
            </div>
          )}

          {allCards && onAddRelation && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500">Relationships</label>
                <button
                  onClick={() => setShowRelationPicker(!showRelationPicker)}
                  className="text-xs text-emerald-600 hover:text-emerald-700"
                >
                  {showRelationPicker ? "Cancel" : "+ Add relationship"}
                </button>
              </div>

              {showRelationPicker && (
                <div className="mt-2">
                  <RelationshipPicker
                    cards={allCards}
                    currentCardId={draft.id}
                    onSelect={handleAddRelation}
                    onCancel={() => setShowRelationPicker(false)}
                  />
                </div>
              )}

              {card?.relations && card.relations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {card.relations.map((rel) => (
                    <RelationshipBadge
                      key={rel.id}
                      relation={rel}
                      targetCard={allCards.find((c) => c.id === rel.targetCardId)}
                      onRemove={onRemoveRelation ? () => handleRemoveRelation(rel.id) : undefined}
                    />
                  ))}
                </div>
              )}

              {(!card?.relations || card.relations.length === 0) && !showRelationPicker && (
                <div className="mt-2 text-xs text-gray-400">
                  No relationships yet
                </div>
              )}
            </div>
          )}

          {/* Attachments Section */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Attachments</label>

            {!isStorageConfigured || !userId ? (
              <div className="mt-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 p-4">
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                  <AlertCircle size={16} />
                  <span className="text-sm font-medium">Cloud sync required</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Sign in and configure Supabase to enable file attachments.
                </p>
              </div>
            ) : (
              <>
                {/* Drop zone */}
                <div
                  className={`mt-2 cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition ${
                    isDragOver
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30"
                      : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={24} className="mx-auto text-gray-400" />
                  <p className="mt-1 text-sm text-gray-600">
                    Drop files here or <span className="text-emerald-600">browse</span>
                  </p>
                  <p className="text-xs text-gray-400">Max 10MB per file</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </div>

                {/* Upload error */}
                {uploadError && (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {uploadError}
                  </div>
                )}

                {/* Upload progress */}
                {uploads
                  .filter((u) => u.status === "uploading")
                  .map((upload) => (
                    <div key={upload.attachmentId} className="mt-2 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">Uploading...</span>
                    </div>
                  ))}

                {/* Attachment list */}
                {(draft?.attachments?.length ?? 0) > 0 && (
                  <div className="mt-3 space-y-2">
                    {draft?.attachments?.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2"
                      >
                        {/* Preview/Icon */}
                        {isImageType(att.type) && signedUrls[att.id] ? (
                          <img
                            src={signedUrls[att.id]}
                            alt={att.name}
                            className="h-12 w-12 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-100">
                            <FileText size={20} className="text-gray-400" />
                          </div>
                        )}

                        {/* File info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{att.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(att.size)}</p>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1">
                          {signedUrls[att.id] && (
                            <a
                              href={signedUrls[att.id]}
                              download={att.name}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                              title="Download"
                            >
                              <Download size={16} />
                            </a>
                          )}
                          <button
                            onClick={() => handleDeleteAttachment(att)}
                            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        </div>

        {/* Fixed Footer */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-gray-100 dark:border-gray-700 px-4 py-3 sm:flex-row sm:justify-between sm:px-6 sm:py-4">
          <div className="order-2 flex gap-2 sm:order-1">
            <button
              onClick={() => onDelete(draft.id)}
              className="flex items-center justify-center gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              <Trash2 size={16} />
              Delete
            </button>
            {onArchive && (
              <button
                onClick={() => onArchive(draft.id)}
                className="flex items-center justify-center gap-2 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                <Archive size={16} />
                Archive
              </button>
            )}
            {onMarkComplete && !isCompleted && (
              <button
                onClick={() => onMarkComplete(draft.id)}
                className="flex items-center justify-center gap-2 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
              >
                <CheckCircle size={16} />
                Complete
              </button>
            )}
          </div>

          <div className="order-1 flex gap-2 sm:order-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 sm:flex-none"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft)}
              className="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 sm:flex-none"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
