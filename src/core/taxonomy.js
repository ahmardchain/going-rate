// The fixed set of task types. SERV may only answer with one of these ids,
// which keeps the rate card's buckets stable across agents and over time.
export const TASK_TYPES = [
  { id: "data-api-lookup", label: "Data API lookups", hint: "weather, prices, FX, search, news, geocoding, any per-call data API" },
  { id: "llm-inference", label: "LLM inference", hint: "text generation, summarising, translation, embeddings via a paid model API" },
  { id: "image-generation", label: "Image generation", hint: "creating or editing images, thumbnails, logos, illustrations" },
  { id: "audio-generation", label: "Audio and speech", hint: "text-to-speech, voiceover, music, transcription" },
  { id: "video-generation", label: "Video generation", hint: "creating or editing video clips" },
  { id: "web-scraping", label: "Web scraping and crawling", hint: "fetching or crawling many pages, browser automation, extraction at volume" },
  { id: "cloud-compute", label: "Cloud compute", hint: "GPU or CPU jobs, hosting, deploys, storage, prepaid cloud projects" },
  { id: "other", label: "Other", hint: "anything that clearly fits none of the above" },
];

export const TASK_TYPE_IDS = TASK_TYPES.map((t) => t.id);
export const labelFor = (id) => TASK_TYPES.find((t) => t.id === id)?.label ?? id;
