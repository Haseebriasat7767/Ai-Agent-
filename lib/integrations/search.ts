import { env, requestJson } from "./http";

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedDate?: string;
}

export interface SearchResponse {
  ok: boolean;
  provider: string;
  query: string;
  answer?: string | null;
  results: SearchResultItem[];
  error?: string;
  hint?: string;
}

export function searchProvider(): { name: "tavily" | "brave" | "serper" | null; status: string } {
  if (env("TAVILY_API_KEY")) return { name: "tavily", status: "Tavily configured" };
  if (env("BRAVE_SEARCH_API_KEY")) return { name: "brave", status: "Brave Search configured" };
  if (env("SERPER_API_KEY")) return { name: "serper", status: "Serper configured" };
  return { name: null, status: "No search provider configured" };
}

export function searchUnavailable(): SearchResultItem[] {
  return [];
}

/**
 * Live web search. Returns `ok: false` with a clear hint when no provider is
 * configured — the agent must never invent results to fill the gap.
 */
export async function webSearch(query: string, options: { count?: number; topic?: "general" | "news" } = {}): Promise<SearchResponse> {
  const provider = searchProvider();
  const count = Math.min(Math.max(options.count ?? 8, 1), 20);
  if (!provider.name) {
    return {
      ok: false,
      provider: "none",
      query,
      results: [],
      error: "Web search is not configured on this deployment.",
      hint:
        "Add TAVILY_API_KEY, BRAVE_SEARCH_API_KEY or SERPER_API_KEY to the environment, then retry. " +
        "Until then, report search results as unavailable rather than guessing.",
    };
  }

  if (provider.name === "tavily") {
    const response = await requestJson<{
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string; published_date?: string }>;
    }>("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env("TAVILY_API_KEY"),
        query,
        max_results: count,
        search_depth: "advanced",
        include_answer: true,
        topic: options.topic ?? "general",
      }),
    });
    if (!response.ok) {
      return { ok: false, provider: "tavily", query, results: [], error: response.error, hint: response.retryable ? "Provider rate limited or unavailable — retry shortly." : undefined };
    }
    const results = (response.data?.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title || item.url || "",
        url: item.url as string,
        snippet: (item.content || item.raw_content || "").slice(0, 1200),
        publishedDate: item.published_date || undefined,
      }));
    return { ok: true, provider: "tavily", query, answer: response.data?.answer ?? null, results };
  }

  if (provider.name === "brave") {
    const response = await requestJson<{ web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> } }>(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      { headers: { accept: "application/json", "x-subscription-token": env("BRAVE_SEARCH_API_KEY") } },
    );
    if (!response.ok) {
      return { ok: false, provider: "brave", query, results: [], error: response.error, hint: response.retryable ? "Provider rate limited or unavailable — retry shortly." : undefined };
    }
    const results = (response.data?.web?.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title || item.url || "",
        url: item.url as string,
        snippet: (item.description || "").slice(0, 1200),
        publishedDate: item.age || undefined,
      }));
    return { ok: true, provider: "brave", query, results };
  }

  const response = await requestJson<{ organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>; answerBox?: { answer?: string; snippet?: string } }>(
    "https://google.serper.dev/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env("SERPER_API_KEY") },
      body: JSON.stringify({ q: query, num: count }),
    },
  );
  if (!response.ok) {
    return { ok: false, provider: "serper", query, results: [], error: response.error, hint: response.retryable ? "Provider rate limited or unavailable — retry shortly." : undefined };
  }
  const results = (response.data?.organic ?? [])
    .filter((item) => item.link)
    .map((item) => ({
      title: item.title || item.link || "",
      url: item.link as string,
      snippet: (item.snippet || "").slice(0, 1200),
      publishedDate: item.date || undefined,
    }));
  return {
    ok: true,
    provider: "serper",
    query,
    answer: response.data?.answerBox?.answer || response.data?.answerBox?.snippet || null,
    results,
  };
}
