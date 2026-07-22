(() => {
  const feedUrl = "https://brucebawest.com/blog/feed.xml";
  const dialog = document.querySelector("#rss-subscribe-dialog");

  if (!dialog) return;

  const status = dialog.querySelector("[data-rss-status]");
  const copyButton = dialog.querySelector("[data-rss-copy]");
  const input = dialog.querySelector("#rss-feed-url");

  const openDialog = (trigger) => {
    if (typeof dialog.showModal !== "function") return false;
    dialog.showModal();
    dialog.dataset.triggerId = trigger.id || "";
    return true;
  };

  const copyFeedUrl = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
    } catch (_) {
      input.focus();
      input.select();
      document.execCommand("copy");
      input.setSelectionRange(0, 0);
    }

    copyButton.textContent = "Copied";
    status.textContent = "Feed URL copied to your clipboard.";

    window.setTimeout(() => {
      copyButton.textContent = "Copy feed URL";
      status.textContent = "";
    }, 2400);
  };

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-rss-subscribe], .md-social__link[href$='/blog/feed.xml']");
    if (trigger && openDialog(trigger)) {
      event.preventDefault();
      return;
    }

    if (event.target === dialog) dialog.close();
  });

  copyButton.addEventListener("click", copyFeedUrl);

  dialog.addEventListener("close", () => {
    copyButton.textContent = "Copy feed URL";
    status.textContent = "";
  });
})();
