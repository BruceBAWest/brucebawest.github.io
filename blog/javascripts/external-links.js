(() => {
  const configureExternalLinks = () => {
    document.querySelectorAll(".md-content a[href]").forEach((link) => {
      if (!/^https?:$/.test(link.protocol) || link.origin === window.location.origin) return;

      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  };

  if (typeof document$ !== "undefined") {
    document$.subscribe(configureExternalLinks);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", configureExternalLinks);
  } else {
    configureExternalLinks();
  }
})();
