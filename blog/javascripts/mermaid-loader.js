(() => {
  const loaderScript = document.currentScript;
  const bundleUrl = new URL("mermaid-11.17.2.min.js", loaderScript.src).href;
  const bundleIntegrity = "sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2";
  let loadPromise = null;
  let initialized = false;
  let diagramSequence = 0;

  const theme = {
    darkMode: true,
    background: "#07090d",
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    primaryColor: "#10151d",
    primaryTextColor: "#f2f5f7",
    primaryBorderColor: "#7de3ee",
    lineColor: "#7de3ee",
    secondaryColor: "#171326",
    secondaryTextColor: "#f2f5f7",
    secondaryBorderColor: "#a99df3",
    tertiaryColor: "#241d10",
    tertiaryTextColor: "#f2f5f7",
    tertiaryBorderColor: "#f4c979",
    clusterBkg: "#0b0e14",
    clusterBorder: "#74808e",
    edgeLabelBackground: "#07090d",
    noteBkgColor: "#171326",
    noteTextColor: "#f2f5f7",
    noteBorderColor: "#a99df3",
    actorBkg: "#10151d",
    actorBorder: "#7de3ee",
    actorTextColor: "#f2f5f7",
    signalColor: "#7de3ee",
    signalTextColor: "#f2f5f7",
    labelBoxBkgColor: "#10151d",
    labelBoxBorderColor: "#a99df3",
    labelTextColor: "#f2f5f7",
    loopTextColor: "#f2f5f7",
    activationBkgColor: "#241d10",
    activationBorderColor: "#f4c979",
    sequenceNumberColor: "#07090d",
  };

  const ensureBundle = () => {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = bundleUrl;
      script.async = true;
      script.integrity = bundleIntegrity;
      script.crossOrigin = "anonymous";
      script.addEventListener("load", () => resolve(window.mermaid), { once: true });
      script.addEventListener("error", () => reject(new Error("Unable to load the local Mermaid renderer.")), { once: true });
      document.head.append(script);
    });
    return loadPromise;
  };

  const configure = (mermaid) => {
    if (initialized) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: theme,
      htmlLabels: false,
      deterministicIds: true,
      deterministicIDSeed: "brucebawest-field-notes",
      flowchart: { htmlLabels: false, useMaxWidth: true, curve: "basis" },
      sequence: { useMaxWidth: true },
      themeCSS: `
        .label, .nodeLabel, .edgeLabel, .messageText, .loopText, .noteText {
          font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
      `,
    });
    initialized = true;
  };

  const showFailure = (element) => {
    element.dataset.bwMermaidFailed = "true";
    element.classList.add("bw-mermaid--error");
    const notice = document.createElement("span");
    notice.className = "bw-mermaid__error";
    notice.setAttribute("role", "alert");
    notice.textContent = "Diagram rendering failed. The readable Mermaid source follows.";
    element.prepend(notice);
  };

  const enhanceDiagram = (element) => {
    const svg = element.querySelector("svg");
    if (!svg) return;
    const title = svg.querySelector("title")?.textContent?.trim() || "Field Notes diagram";
    const intrinsicWidth = svg.viewBox?.baseVal?.width;
    if (Number.isFinite(intrinsicWidth) && intrinsicWidth > 0) {
      element.style.setProperty("--bw-mermaid-width", `${intrinsicWidth}px`);
    }
    svg.setAttribute("focusable", "false");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", `Diagram: ${title}`);
    element.tabIndex = 0;
  };

  const render = async () => {
    const diagrams = Array.from(document.querySelectorAll(
      ".md-typeset .bw-mermaid-source:not([data-bw-mermaid-rendered]):not([data-bw-mermaid-failed])"
    ));
    if (!diagrams.length) return;

    try {
      const mermaid = await ensureBundle();
      if (!mermaid) throw new Error("Mermaid did not initialize.");
      configure(mermaid);

      for (const element of diagrams) {
        const source = element.textContent.trim();
        try {
          const id = `bw-mermaid-${Date.now()}-${diagramSequence += 1}`;
          const result = await mermaid.render(id, source);
          element.replaceChildren();
          element.insertAdjacentHTML("afterbegin", result.svg);
          result.bindFunctions?.(element);
          element.dataset.bwMermaidRendered = "true";
          enhanceDiagram(element);
        } catch (_error) {
          showFailure(element);
        }
      }
    } catch (_error) {
      diagrams.forEach(showFailure);
    }
  };

  if (window.document$?.subscribe) {
    window.document$.subscribe(render);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
