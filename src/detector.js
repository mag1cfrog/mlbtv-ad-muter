(function initializeDetector(root, factory) {
  const detector = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = detector;
  }

  root.BaseballBreakDetector = detector;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDetector() {
  "use strict";

  const SELECTORS = Object.freeze({
    player: '.mlbtv-media-player[aria-label="Media Player"]',
    fallbackPlayer: '[aria-label="Media Player"]',
    video: "video",
    adControls: ".mlbtv-media-controls--ads-controls",
    play: 'button[aria-label="Play"]',
    pause: 'button[aria-label="Pause"]',
    mute: 'button[aria-label="Mute"]',
    unmute: 'button[aria-label="Unmute"]',
    rewind: 'button[aria-label="Rewind 10 seconds"]',
    fastForward: 'button[aria-label="Fast forward 10 seconds"]',
    seekSlider: '[role="slider"][aria-label="Seek slider"]',
    livePoint: 'button[aria-label="Go to Live point"]',
    broadcast: 'button[aria-label="Broadcast selector"]',
    quality: 'button[aria-label="Quality and caption settings"]',
    fullscreen: 'button[aria-label="Watch Full Screen"]'
  });

  function has(scope, selector) {
    return Boolean(scope && scope.querySelector(selector));
  }

  function collectSignals(documentRoot) {
    const player =
      documentRoot.querySelector(SELECTORS.player) ||
      documentRoot.querySelector(SELECTORS.fallbackPlayer);
    const scope = player || documentRoot;
    const video = scope.querySelector(SELECTORS.video);

    return {
      hasPlayer: Boolean(player),
      hasVideo: Boolean(video),
      playerMuted: video ? Boolean(video.muted) : null,
      hasAdControls: has(scope, SELECTORS.adControls),
      hasPlayPause: has(scope, SELECTORS.play) || has(scope, SELECTORS.pause),
      hasVolume: has(scope, SELECTORS.mute) || has(scope, SELECTORS.unmute),
      hasRewind: has(scope, SELECTORS.rewind),
      hasFastForward: has(scope, SELECTORS.fastForward),
      hasSeekSlider: has(scope, SELECTORS.seekSlider),
      hasLivePoint: has(scope, SELECTORS.livePoint),
      hasBroadcast: has(scope, SELECTORS.broadcast),
      hasQuality: has(scope, SELECTORS.quality),
      hasFullscreen: has(scope, SELECTORS.fullscreen)
    };
  }

  function classifySignals(signals) {
    if (!signals.hasPlayer || !signals.hasVideo) {
      return {
        classification: "unknown",
        confidence: 0,
        reason: "player-or-video-missing"
      };
    }

    if (signals.hasAdControls) {
      return {
        classification: "ad",
        confidence: 1,
        reason: "explicit-ad-controls-marker-present"
      };
    }

    const richControlCount = [
      signals.hasRewind,
      signals.hasFastForward,
      signals.hasSeekSlider,
      signals.hasLivePoint,
      signals.hasBroadcast,
      signals.hasQuality,
      signals.hasFullscreen
    ].filter(Boolean).length;

    const hasCoreContentControls =
      signals.hasRewind &&
      signals.hasFastForward &&
      signals.hasSeekSlider;

    if (hasCoreContentControls || richControlCount >= 4) {
      return {
        classification: "content",
        confidence: hasCoreContentControls ? 1 : 0.8,
        reason: "rich-playback-controls-present"
      };
    }

    const hasMinimalPlaybackControls =
      signals.hasPlayPause && signals.hasVolume;

    if (hasMinimalPlaybackControls && richControlCount <= 1) {
      return {
        classification: "ad",
        confidence: richControlCount === 0 ? 0.9 : 0.75,
        reason: "only-minimal-playback-controls-present"
      };
    }

    return {
      classification: "unknown",
      confidence: 0.25,
      reason: "mixed-or-transitional-controls"
    };
  }

  function inspect(documentRoot) {
    const signals = collectSignals(documentRoot);
    return {
      ...classifySignals(signals),
      signals
    };
  }

  return Object.freeze({
    SELECTORS,
    classifySignals,
    collectSignals,
    inspect
  });
});
