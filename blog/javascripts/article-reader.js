(() => {
  const STORAGE_KEY = "bw-reading-preferences-v1";
  const SIZE_STEPS = [90, 100, 115, 130, 150];
  let cleanupCurrentReader = null;

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return "—";
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };

  const readPreferences = () => {
    try {
      return {
        font: "site",
        size: 100,
        theme: "site",
        spacing: "standard",
        ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
      };
    } catch (_error) {
      return { font: "site", size: 100, theme: "site", spacing: "standard" };
    }
  };

  const savePreferences = (preferences) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (_error) {
      // Reading preferences remain available for the current page.
    }
  };

  const readableBlocks = (article) => {
    const blocks = [];
    for (const element of article.querySelectorAll("h1, h2, h3, p, li")) {
      if (element.matches("h2#sources-and-research-trail")) break;
      if (element.matches("p") && element.closest("li")) continue;
      if (element.matches("li") && element.parentElement?.closest("li")) continue;
      if (normalizedBlock(element).text) blocks.push(element);
    }
    return blocks;
  };

  const normalizedBlock = (element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(".headerlink, .footnote-backref")) return NodeFilter.FILTER_REJECT;
        if (element.tagName === "LI") {
          const nearestListItem = parent.closest("li");
          if (nearestListItem && nearestListItem !== element) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let text = "";
    const positions = [];
    let pendingSpace = null;
    let node;
    while ((node = walker.nextNode())) {
      for (let offset = 0; offset < node.data.length; offset += 1) {
        const character = node.data[offset];
        if (/\s/.test(character)) {
          if (text) pendingSpace = { node, offset };
          continue;
        }
        if (pendingSpace && text && !text.endsWith(" ")) {
          text += " ";
          positions.push(pendingSpace);
        }
        pendingSpace = null;
        text += character;
        positions.push({ node, offset });
      }
    }
    return { text, positions };
  };

  const fallbackSegments = (blocks) => {
    const segmenter = "Segmenter" in Intl
      ? new Intl.Segmenter("en", { granularity: "sentence" })
      : null;
    const segments = [];
    blocks.forEach((block, blockIndex) => {
      const text = normalizedBlock(block).text;
      if (!text) return;
      if (/^H[1-3]$/.test(block.tagName)) {
        segments.push({ block: blockIndex, startChar: 0, endChar: text.length, text });
        return;
      }
      if (segmenter) {
        for (const part of segmenter.segment(text)) {
          const spoken = part.segment.trim();
          const leading = part.segment.length - part.segment.trimStart().length;
          if (spoken) {
            segments.push({
              block: blockIndex,
              startChar: part.index + leading,
              endChar: part.index + leading + spoken.length,
              text: spoken,
            });
          }
        }
      } else {
        let cursor = 0;
        for (const part of text.match(/[^.!?]+(?:[.!?]+["'”’]?|$)/g) || [text]) {
          const start = text.indexOf(part.trim(), cursor);
          const spoken = part.trim();
          if (spoken) segments.push({ block: blockIndex, startChar: start, endChar: start + spoken.length, text: spoken });
          cursor = start + spoken.length;
        }
      }
    });
    return segments;
  };

  const initialize = async () => {
    cleanupCurrentReader?.();
    cleanupCurrentReader = null;

    const tools = document.querySelector("[data-reading-tools]");
    const article = document.querySelector(".bw-reader-article");
    if (!tools || !article) return;

    const blocks = readableBlocks(article);
    const blockMaps = blocks.map(normalizedBlock);
    const status = tools.querySelector("[data-reader-status]");
    const playButton = tools.querySelector("[data-reader-play]");
    const playIcon = tools.querySelector("[data-reader-play-icon]");
    const playLabel = tools.querySelector("[data-reader-play-label]");
    const previousButton = tools.querySelector("[data-reader-previous]");
    const nextButton = tools.querySelector("[data-reader-next]");
    const stopButton = tools.querySelector("[data-reader-stop]");
    const progress = tools.querySelector("[data-reader-progress]");
    const currentTime = tools.querySelector("[data-reader-current-time]");
    const duration = tools.querySelector("[data-reader-duration]");
    const rate = tools.querySelector("[data-reader-rate]");
    const audio = tools.querySelector("[data-reader-audio]");
    const font = tools.querySelector("[data-reader-font]");
    const theme = tools.querySelector("[data-reader-theme]");
    const spacing = tools.querySelector("[data-reader-spacing]");
    const sizeOutput = tools.querySelector("[data-reader-size-output]");
    let preferences = readPreferences();
    let manifest = null;
    let segments = [];
    let currentSegment = 0;
    let lastHighlightedSegment = -1;
    let mode = "native";
    let nativePlaying = false;
    let nativePaused = false;
    let disposed = false;

    const applyPreferences = () => {
      article.dataset.readerEnabled = "true";
      article.dataset.readerFont = preferences.font;
      article.dataset.readerTheme = preferences.theme;
      article.dataset.readerSpacing = preferences.spacing;
      article.style.setProperty("--bw-reader-scale", String(preferences.size / 100));
      font.value = preferences.font;
      theme.value = preferences.theme;
      spacing.value = preferences.spacing;
      sizeOutput.value = `${preferences.size}%`;
      sizeOutput.textContent = `${preferences.size}%`;
      savePreferences(preferences);
    };

    const setPlaying = (playing) => {
      playIcon.textContent = playing ? "❚❚" : "▶";
      playLabel.textContent = playing ? "Pause" : "Play article";
      playButton.setAttribute("aria-label", playing ? "Pause article" : "Play article");
    };

    const clearHighlight = () => {
      if (CSS.highlights) CSS.highlights.delete("bw-reader-active");
      blocks.forEach((block) => block.classList.remove("bw-reader-block--active"));
    };

    const highlight = (segmentIndex, startOverride = null, endOverride = null, scroll = true) => {
      const segment = segments[segmentIndex];
      const block = segment ? blocks[segment.block] : null;
      const map = segment ? blockMaps[segment.block] : null;
      if (!segment || !block || !map?.positions.length) return;
      clearHighlight();

      const start = Math.max(0, Math.min(startOverride ?? segment.startChar, map.positions.length - 1));
      const end = Math.max(start + 1, Math.min(endOverride ?? segment.endChar, map.positions.length));
      const startPosition = map.positions[start];
      const endPosition = map.positions[end - 1];
      if (CSS.highlights && window.Highlight && startPosition && endPosition) {
        const rangeObject = new Range();
        rangeObject.setStart(startPosition.node, startPosition.offset);
        rangeObject.setEnd(endPosition.node, endPosition.offset + 1);
        CSS.highlights.set("bw-reader-active", new Highlight(rangeObject));
      } else {
        block.classList.add("bw-reader-block--active");
      }

      if (scroll && lastHighlightedSegment !== segmentIndex) {
        block.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
      lastHighlightedSegment = segmentIndex;
    };

    const findAudioSegment = (time) => {
      let low = 0;
      let high = segments.length - 1;
      let result = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const segment = segments[middle];
        if (segment.start <= time) {
          result = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      return result;
    };

    const stopNative = (reset = true) => {
      speechSynthesis.cancel();
      nativePlaying = false;
      nativePaused = false;
      setPlaying(false);
      if (reset) {
        currentSegment = 0;
        progress.value = "0";
        currentTime.textContent = "0:00";
        clearHighlight();
      }
    };

    const speakCurrent = () => {
      if (disposed || !segments[currentSegment]) return;
      speechSynthesis.cancel();
      const segment = segments[currentSegment];
      const utterance = new SpeechSynthesisUtterance(segment.text);
      utterance.lang = "en-US";
      utterance.rate = Number(rate.value);
      utterance.onstart = () => {
        nativePlaying = true;
        nativePaused = false;
        setPlaying(true);
        highlight(currentSegment);
      };
      utterance.onboundary = (event) => {
        if (event.name !== "word" || !event.charLength) return;
        highlight(
          currentSegment,
          segment.startChar + event.charIndex,
          segment.startChar + event.charIndex + event.charLength,
          false,
        );
      };
      utterance.onend = () => {
        if (!nativePlaying || disposed) return;
        if (currentSegment < segments.length - 1) {
          currentSegment += 1;
          progress.value = String((currentSegment / Math.max(1, segments.length - 1)) * 100);
          currentTime.textContent = `${currentSegment + 1} / ${segments.length}`;
          speakCurrent();
        } else {
          stopNative(false);
          progress.value = "100";
          currentTime.textContent = `${segments.length} / ${segments.length}`;
        }
      };
      utterance.onerror = (event) => {
        if (event.error !== "canceled" && event.error !== "interrupted") {
          status.textContent = "The browser voice could not continue. Try stopping and starting again.";
        }
      };
      speechSynthesis.speak(utterance);
    };

    const enableControls = () => {
      [playButton, previousButton, nextButton, stopButton, progress, rate].forEach((control) => {
        control.disabled = false;
      });
    };

    const useNativeVoice = () => {
      mode = "native";
      segments = fallbackSegments(blocks);
      duration.textContent = `${segments.length} sentences`;
      currentTime.textContent = segments.length ? `1 / ${segments.length}` : "0 / 0";
      status.textContent = "Browser voice available. Sentence tracking is on; word tracking appears when the browser provides it.";
      enableControls();
    };

    applyPreferences();
    font.addEventListener("change", () => { preferences.font = font.value; applyPreferences(); });
    theme.addEventListener("change", () => { preferences.theme = theme.value; applyPreferences(); });
    spacing.addEventListener("change", () => { preferences.spacing = spacing.value; applyPreferences(); });
    tools.querySelector("[data-reader-size-down]").addEventListener("click", () => {
      const index = Math.max(0, SIZE_STEPS.indexOf(preferences.size));
      preferences.size = SIZE_STEPS[Math.max(0, index - 1)];
      applyPreferences();
    });
    tools.querySelector("[data-reader-size-up]").addEventListener("click", () => {
      const index = Math.max(0, SIZE_STEPS.indexOf(preferences.size));
      preferences.size = SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, index + 1)];
      applyPreferences();
    });
    tools.querySelector("[data-reader-reset]").addEventListener("click", () => {
      preferences = { font: "site", size: 100, theme: "site", spacing: "standard" };
      applyPreferences();
    });

    playButton.addEventListener("click", () => {
      if (mode === "kokoro") {
        if (audio.paused) audio.play();
        else audio.pause();
        return;
      }
      if (nativePlaying && !nativePaused) {
        speechSynthesis.pause();
        nativePaused = true;
        setPlaying(false);
      } else if (nativePaused) {
        speechSynthesis.resume();
        nativePaused = false;
        setPlaying(true);
      } else {
        speakCurrent();
      }
    });

    previousButton.addEventListener("click", () => {
      currentSegment = (currentSegment - 1 + segments.length) % segments.length;
      if (mode === "kokoro") {
        audio.currentTime = segments[currentSegment].start;
        audio.play();
      } else {
        speakCurrent();
      }
    });

    nextButton.addEventListener("click", () => {
      currentSegment = (currentSegment + 1) % segments.length;
      if (mode === "kokoro") {
        audio.currentTime = segments[currentSegment].start;
        audio.play();
      } else {
        speakCurrent();
      }
    });

    stopButton.addEventListener("click", () => {
      if (mode === "kokoro") {
        audio.pause();
        audio.currentTime = 0;
        setPlaying(false);
        clearHighlight();
      } else {
        stopNative();
      }
    });

    rate.addEventListener("change", () => {
      if (mode === "kokoro") audio.playbackRate = Number(rate.value);
      else if (nativePlaying || nativePaused) speakCurrent();
    });

    progress.addEventListener("input", () => {
      if (mode === "kokoro") {
        audio.currentTime = (Number(progress.value) / 100) * audio.duration;
      } else {
        currentSegment = Math.min(
          segments.length - 1,
          Math.round((Number(progress.value) / 100) * Math.max(0, segments.length - 1)),
        );
        highlight(currentSegment);
        currentTime.textContent = `${currentSegment + 1} / ${segments.length}`;
      }
    });

    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => {
      setPlaying(false);
      clearHighlight();
    });
    audio.addEventListener("loadedmetadata", () => {
      duration.textContent = formatTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      if (!audio.duration) return;
      progress.value = String((audio.currentTime / audio.duration) * 100);
      currentTime.textContent = formatTime(audio.currentTime);
      const segmentIndex = findAudioSegment(audio.currentTime);
      if (segmentIndex !== currentSegment || lastHighlightedSegment < 0) {
        currentSegment = segmentIndex;
        highlight(currentSegment);
      }
    });

    try {
      const manifestUrl = new URL(tools.dataset.audioManifest, window.location.href);
      const response = await fetch(manifestUrl, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Audio manifest returned ${response.status}`);
      manifest = await response.json();
      if (!Array.isArray(manifest.segments) || !manifest.segments.length) throw new Error("Audio manifest has no segments");
      mode = "kokoro";
      segments = manifest.segments;
      audio.src = new URL(manifest.audio, manifestUrl).href;
      audio.playbackRate = Number(rate.value);
      status.textContent = "Kokoro studio voice ready. Sentence tracking follows the recording.";
      enableControls();
    } catch (_error) {
      if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) useNativeVoice();
      else status.textContent = "Audio is not available in this browser. Reading preferences still work.";
    }

    cleanupCurrentReader = () => {
      disposed = true;
      audio.pause();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      clearHighlight();
    };
  };

  if (typeof document$ !== "undefined") document$.subscribe(initialize);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
