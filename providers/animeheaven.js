/**
 * AnimeHeaven — anImestream Format A provider.
 *
 * Ported from Seanime's src/anime/animeheaven/provider.js (v1.1.4), which is
 * known to work. AnimeHeaven is not one of the app's built-in sources.
 *
 * Why this provider is a good Format A fit: it needs no stream extractor. The
 * gate page hands back a direct .mp4, so nothing has to be decrypted or
 * signed. Parsing is regex-only, so no DOM is required beyond `RegExp`.
 *
 * One runtime requirement: the gate call authenticates with a `Cookie` header.
 * See "Cookie requirement" in the repository README.
 */

const BASE = "https://animeheaven.me";

function decodeEntities(text) {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

module.exports = {
  async search(input, api) {
    const query = input && input.query ? String(input.query) : "";
    if (!query) return [];

    const res = await api.request({
      url: BASE + "/search.php?s=" + encodeURIComponent(query)
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return [];

    // The original uses the `s` (dotAll) flag; [\s\S] is used here so the
    // pattern does not depend on dotAll support in the engine.
    const pattern = /<div class='similarimg'>[\s\S]*?<a href='(anime\.php\?[^']*)'><img[\s\S]*?alt='([^']*)'/g;

    const results = [];
    let match;
    while ((match = pattern.exec(res.body)) !== null) {
      const path = match[1];
      const title = decodeEntities(match[2]).trim();
      if (!path || !title) continue;

      results.push({
        name: title,
        // The full URL: getAnimeEpisodeLink receives this back verbatim.
        alias: BASE + "/" + path,
        imageUrl: undefined
      });
    }
    return results;
  },

  async getAnimeEpisodeLink(input, api) {
    const aliasId = input && input.aliasId ? String(input.aliasId) : "";
    if (!aliasId) return [];

    const res = await api.request({ url: aliasId });
    if (res.statusCode < 200 || res.statusCode >= 300) return [];

    // Each episode is an <a> carrying a stable id; the inline handler has
    // inconsistent whitespace, so the anchor id is the reliable key.
    const pattern = /<a\b([^>]*\bid\s*=\s*["'][^"']+["'][^>]*)>[\s\S]*?<div[^>]*\bwatch2\b[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/div>[\s\S]*?<\/a>/gi;
    const idPattern = /\bid\s*=\s*["']([^"']+)["']/i;

    const episodes = [];
    let match;
    while ((match = pattern.exec(res.body)) !== null) {
      const idMatch = idPattern.exec(match[1]);
      const gateKey = idMatch ? idMatch[1] : "";
      const number = Number.parseFloat(match[2]);
      if (!gateKey || !Number.isFinite(number)) continue;

      episodes.push({
        // Handed straight back as `episodeId` in getStreams.
        episodeLink: gateKey,
        // AnimeHeaven numbers specials fractionally (12.5). The app's episode
        // number must be an integer, so it is floored here; `episodeLink`
        // remains the true identity of the episode.
        episodeNumber: Math.floor(number),
        episodeTitle: "Episode " + number,
        metadata: gateKey
      });
    }

    // The page lists newest first.
    episodes.sort(function (a, b) {
      return Number.parseFloat(a.episodeTitle.replace("Episode ", "")) -
        Number.parseFloat(b.episodeTitle.replace("Episode ", ""));
    });
    return episodes;
  },

  async getStreams(input, api) {
    const gateKey = input && input.episodeId ? String(input.episodeId) : "";
    if (!gateKey) return [];

    // NOTE: this request sets a Cookie. The runtime's blocked-header list has
    // to allow `cookie` for this to work; see the repository README.
    const res = await api.request({
      url: BASE + "/gate.php",
      headers: {
        Cookie: "key=" + gateKey,
        Referer: BASE + "/anime.php"
      }
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return [];

    const html = res.body;
    let videoUrl = null;

    // 1. A <source> tag on the page.
    const sourceMatch = html.match(/<source[^>]+src=['"]([^'"]+\.mp4[^'"]*)['"]/i);
    if (sourceMatch) videoUrl = sourceMatch[1];

    // 2. The download anchor.
    if (!videoUrl) {
      const downloadMatch = html.match(/href='(https?:\/\/ax\.animeheaven\.me\/video\.mp4\?[^']+)'/);
      if (downloadMatch) videoUrl = downloadMatch[1];
    }

    // 3. Rebuild from the two tokens the page embeds.
    if (!videoUrl) {
      const tokenMatch = html.match(/video\.mp4\?([a-f0-9]+)&([a-f0-9]+)/);
      if (tokenMatch) {
        videoUrl = "https://ax.animeheaven.me/video.mp4?" + tokenMatch[1] + "&" + tokenMatch[2];
      }
    }

    if (!videoUrl) return [];

    return [
      {
        quality: "auto",
        url: videoUrl,
        server: "AnimeHeaven",
        backup: false,
        // The stream host rejects requests without these.
        customHeaders: {
          Referer: BASE + "/",
          Origin: BASE
        }
      }
    ];
  }
};
