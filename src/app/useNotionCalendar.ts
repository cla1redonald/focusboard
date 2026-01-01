import React from "react";

export type NotionEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  isAllDay: boolean;
  url?: string;
};

export type NotionDatabase = {
  id: string;
  title: string;
  dateProperties: string[];
  url?: string;
};

type NotionCalendarState = {
  connected: boolean;
  databaseId?: string;
  loading: boolean;
  error?: string;
};

export function useNotionCalendar() {
  const [state, setState] = React.useState<NotionCalendarState>({
    connected: false,
    loading: false
  });
  const [events, setEvents] = React.useState<NotionEvent[]>([]);
  const [databases, setDatabases] = React.useState<NotionDatabase[]>([]);

  // Fetch available databases
  const fetchDatabases = React.useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    try {
      const res = await fetch("/api/notion/databases");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch databases");
      }

      setDatabases(data.databases || []);
      setState((prev) => ({
        ...prev,
        connected: data.databases?.length > 0,
        loading: false
      }));

      return data.databases || [];
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setState((prev) => ({
        ...prev,
        connected: false,
        loading: false,
        error: errorMsg
      }));
      return [];
    }
  }, []);

  // Fetch events for a date range
  const fetchEvents = React.useCallback(
    async (startDate: string, endDate: string, databaseId?: string) => {
      setState((prev) => ({ ...prev, loading: true, error: undefined }));

      try {
        const res = await fetch("/api/notion/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate,
            endDate,
            databaseId: databaseId || state.databaseId
          })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch events");
        }

        setEvents(data.events || []);
        setState((prev) => ({
          ...prev,
          connected: true,
          loading: false,
          databaseId: data.databaseId
        }));

        return data.events || [];
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errorMsg
        }));
        return [];
      }
    },
    [state.databaseId]
  );

  // Set the database to use
  const setDatabaseId = React.useCallback((id: string) => {
    setState((prev) => ({ ...prev, databaseId: id }));
  }, []);

  // Get events for a specific date
  const getEventsForDate = React.useCallback(
    (date: string): NotionEvent[] => {
      return events.filter((event) => event.date === date);
    },
    [events]
  );

  // Count events per date (for quick lookups)
  const eventCountByDate = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const event of events) {
      counts[event.date] = (counts[event.date] || 0) + 1;
    }
    return counts;
  }, [events]);

  return {
    // State
    connected: state.connected,
    loading: state.loading,
    error: state.error,
    databaseId: state.databaseId,

    // Data
    events,
    databases,
    eventCountByDate,

    // Actions
    fetchDatabases,
    fetchEvents,
    setDatabaseId,
    getEventsForDate
  };
}
