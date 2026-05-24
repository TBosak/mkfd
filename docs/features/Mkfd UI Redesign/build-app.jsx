// Mount Build Feed page.
const getEditFeed = () => {
  const m = window.location.search.match(/[?&]edit=([^&]+)/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  const feed = (window.SAMPLE_FEEDS || []).find((f) => f.id === id);
  if (!feed) return null;
  return {
    feedType: feed.type,
    feedName: feed.title,
    category: feed.category,
    tags: feed.tags,
    refreshMinutes: feed.refreshMinutes,
    baseUrl: feed.sourceUrl,
  };
};

const BuildApp = () => (
  <ToastProvider>
    <BuildFeedPage initial={getEditFeed()} />
  </ToastProvider>
);
ReactDOM.createRoot(document.getElementById("root")).render(<BuildApp />);
