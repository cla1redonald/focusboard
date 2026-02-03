import React from "react";

type UnsplashImage = {
  id: string;
  urls: {
    small: string;
    regular: string;
    thumb: string;
  };
  alt_description: string | null;
  user: {
    name: string;
    links: {
      html: string;
    };
  };
};

type Props = {
  onSelect: (imageUrl: string) => void;
  onCancel: () => void;
};

const UNSPLASH_ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY;

// Popular search suggestions
const SUGGESTIONS = ["nature", "abstract", "minimal", "gradient", "workspace", "mountains", "ocean", "city", "forest", "sunset"];

export function UnsplashPicker({ onSelect, onCancel }: Props) {
  const [query, setQuery] = React.useState("");
  const [images, setImages] = React.useState<UnsplashImage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const searchImages = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    if (!UNSPLASH_ACCESS_KEY) {
      setError("Unsplash API key not configured");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=12&orientation=landscape`,
        {
          headers: {
            Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch images");
      }

      const data = await response.json();
      setImages(data.results);
    } catch (err) {
      setError("Failed to search images. Please try again.");
      console.error("Unsplash search error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void searchImages(query);
  };

  if (!UNSPLASH_ACCESS_KEY) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4">
        <div className="text-sm font-medium text-gray-900 dark:text-white">Unsplash not configured</div>
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          To enable image search, add your free Unsplash API key:
        </div>
        <ol className="mt-2 list-decimal pl-4 text-xs text-gray-600 dark:text-gray-400 space-y-1">
          <li>Go to <a href="https://unsplash.com/developers" target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">unsplash.com/developers</a></li>
          <li>Create a free account and new application</li>
          <li>Copy your Access Key</li>
          <li>Add <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">VITE_UNSPLASH_ACCESS_KEY=your_key</code> to .env.local</li>
        </ol>
        <button
          onClick={onCancel}
          className="mt-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search images..."
          className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "..." : "Search"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          Cancel
        </button>
      </form>

      {/* Suggestions */}
      {images.length === 0 && !loading && !error && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setQuery(suggestion);
                void searchImages(suggestion);
              }}
              className="rounded-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>
      )}

      {/* Results Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onSelect(image.urls.regular)}
              className="group relative aspect-video overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600 hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <img
                src={image.urls.thumb}
                alt={image.alt_description ?? "Unsplash image"}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition">
                <div className="absolute bottom-1 left-1 right-1 truncate text-[10px] text-white">
                  by {image.user.name}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="text-[10px] text-gray-500 dark:text-gray-400">
          Photos from <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer" className="hover:underline">Unsplash</a>
        </div>
      )}
    </div>
  );
}
