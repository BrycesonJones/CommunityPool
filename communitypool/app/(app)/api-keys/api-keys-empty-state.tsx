"use client";

export function ApiKeysEmptyState() {
  return (
    <section
      aria-labelledby="api-keys-empty-title"
      className="flex min-h-[70vh] items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/60"
    >
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-white"
            aria-hidden
          >
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
            <path d="M14 3v5h5" />
          </svg>
          <h2
            id="api-keys-empty-title"
            className="text-lg font-semibold text-white"
          >
            No API keys
          </h2>
        </div>
        <p className="mt-3 max-w-sm text-sm text-zinc-400">
          Create API keys to view and manage them here.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            View API docs
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            Create API key
          </button>
        </div>
      </div>
    </section>
  );
}

export default ApiKeysEmptyState;
