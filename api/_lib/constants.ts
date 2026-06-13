/**
 * Shared API limits — single source of truth.
 *
 * Keep write-side validation and read-side serialization in lockstep. When
 * these drifted apart (validator accepted 5000, slimCard returned 280), notes
 * between 281–5000 chars were stored but silently truncated on read, causing
 * round-trip data loss. See focusboard#55.
 */

/** Max length of a card's `notes` field, enforced on write and serialization. */
export const NOTES_MAX_LENGTH = 5000;
