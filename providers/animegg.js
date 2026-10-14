/**
 * AnimeGG — anImestream Format A *anime* provider.
 *
 * Contract (see the anime side's JavaScript provider; the same
 * `module.exports` + `(input, api)` shape AnimeHeaven uses):
 *
 *   search({ query }, api)
 *     -> [{ name, alias, imageUrl }]
 *   getAnimeEpisodeLink({ aliasId }, api)
 *     -> [{ episodeLink, episodeNumber, episodeTitle, metadata }]
 *   getStreams({ episodeId }, api)
 *     -> [{ quality, url, server, backup, customHeaders }]
 *
 * Ported from Seanime's src/anime/animegg provider, which is known to work.
 * Like AnimeHeaven it needs no stream extractor: the embed page holds a plain
 * `var videoSources = [{file, label, bk}]` array whose `file` is an .mp4 on the
 * site itself, so nothing has to be decrypted or signed.
 *
 * The chain, all on https://www.animegg.org:
 *   1. /search/?q=...            — series links
 *   2. /series/<slug>            — episode anchors (class `anm_det_pop`)
 *   3. /<episode slug>           — a tab carrying the embed id: data-id="147203"
 *   4. /embed/<id>               — the videoSources array
 *   5. /play/<n>/video.mp4?for=… — the stream itself
 *
 * Step 5 answers 302 to a tokenised CDN host. api.request must not be used for
 * it (the runtime refuses redirects), but the player follows redirects itself,
 * which is why the URL is handed over rather than fetched. A Referer is sent
 * with it, without which the redirect is not issued.
 *
 * ES5 only, deliberately: this code runs inside the app's JS engine, so no
 * template literals, no arrow functions and no `atob` (base64 is decoded by
 * hand below).
 */

var BASE = "https://www.animegg.org";

function decodeEntities(text) {
  return String(text)
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(text) {
  return decodeEntities(String(text).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function absolute(url) {
  if (!url) return url;
  return url.indexOf("http") === 0 ? url : BASE + url;
}

var BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** No `atob` in this engine, and `bk` is base64-encoded, so decode it here. */
function base64Decode(value) {
  var input = String(value).replace(/[^A-Za-z0-9+/=]/g, "");
  var output = "";
  var buffer = 0;
  var bits = 0;
  var i;
  for (i = 0; i < input.length; i++) {
    var char = input.charAt(i);
    if (char === "=") break;
    var index = BASE64_CHARS.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 255);
    }
  }
  return output;
}

async function body(api, options) {
  var res = await api.request(options);
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("AnimeGG: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("AnimeGG: HTTP " + res.statusCode + " for " + options.url);
  }
  return res.body;
}

/** Series links on a search page, with the dub flag the site marks them with. */
function collectSeries(html) {
  var found = [];
  var seen = {};
  var patterns = [
    /<a\s+href="(\/series\/[^"]+)"\s+class="[^"]*mse[^"]*"[^>]*>[\s\S]*?<h2>([\s\S]*?)<\/h2>/g,
    /<a\s+href="(\/series\/[^"]+)"[\s\S]{0,400}?<h2>([\s\S]*?)<\/h2>/g,
  ];
  for (var p = 0; p < patterns.length && found.length === 0; p++) {
    var match;
    while ((match = patterns[p].exec(html)) !== null) {
      var path = match[1];
      if (seen[path]) continue;
      seen[path] = true;
      found.push({ url: absolute(path), title: stripTags(match[2]) });
    }
  }
  return found;
}

/** Episode anchors: the class is on the anchor, the label inside it. */
function collectEpisodes(html) {
  var episodes = [];
  var seen = {};
  var tagPattern = /<a\b[^>]*>/g;
  var match;
  while ((match = tagPattern.exec(html)) !== null) {
    var tag = match[0];
    if (tag.indexOf("anm_det_pop") < 0) continue;
    var href = /href="([^"]+)"/.exec(tag);
    if (!href) continue;
    var path = href[1];
    if (seen[path]) continue;
    seen[path] = true;

    // Everything up to the anchor's closing tag is this episode's own label.
    var rest = html.slice(tagPattern.lastIndex);
    var label = stripTags(rest.slice(0, rest.indexOf("</a>") + 4));

    var number = null;
    var fromPath = /-episode-([0-9]+(?:\.[0-9]+)?)/i.exec(path);
    if (fromPath) number = Number.parseFloat(fromPath[1]);
    if (number === null || !Number.isFinite(number)) {
      var fromLabel = /([0-9]+(?:\.[0-9]+)?)/.exec(label);
      number = fromLabel ? Number.parseFloat(fromLabel[1]) : 0;
    }

    episodes.push({ url: absolute(path), label: label, number: number });
  }
  return episodes;
}

/**
 * The subbed/dubbed embed id on an episode page.
 *
 * The tab is `<a href="#subbed-Animegg" data-toggle="tab" data-id='147203' …>`,
 * but the page is not consistent about quoting across its catalogue: older
 * episodes write the same tab with single quotes around both attributes. So the
 * anchor is matched without assuming quotes anywhere, and the id is read from
 * the attribute value itself.
 */
function embedId(html, tabId) {
  var pattern = /<a\b[^>]*>/g;
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var tag = match[0];
    if (tag.indexOf(tabId) < 0) continue;
    var id = /data-id\s*=\s*['"]?([0-9]+)/.exec(tag);
    if (id) return id[1];
  }
  return null;
}

/** `var videoSources = [{file: "…", label: "720p", bk: "…"}, …]` */
function videoSources(html) {
  var match = /var\s+videoSources\s*=\s*(\[[\s\S]*?\])/.exec(html);
  if (!match) return [];
  var raw = match[1];
  var sources = [];
  var entryPattern = /file:\s*"([^"]+)"[\s\S]*?label:\s*"([^"]*)"[\s\S]*?bk:\s*"([^"]*)"/g;
  var entry;
  while ((entry = entryPattern.exec(raw)) !== null) {
    sources.push({ file: entry[1], label: entry[2], backup: entry[3] });
  }
  return sources;
}

function qualityRank(label) {
  var parsed = Number.parseInt(String(label), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  async search(input, api) {
    var query = input && input.query ? String(input.query) : "";
    if (!query) return [];

    var html = await body(api, {
      url: BASE + "/search/?q=" + encodeURIComponent(query),
    });

    return collectSeries(html).map(function (series) {
      return {
        name: series.title,
        // The full URL: getAnimeEpisodeLink receives this back verbatim.
        alias: series.url,
        imageUrl: undefined,
      };
    });
  },

  async getAnimeEpisodeLink(input, api) {
    var aliasId = input && input.aliasId ? String(input.aliasId) : "";
    if (!aliasId) return [];

    var html = await body(api, { url: absolute(aliasId) });
    var episodes = collectEpisodes(html);

    // The series page lists newest first.
    episodes.sort(function (left, right) {
      return left.number - right.number;
    });

    return episodes.map(function (episode) {
      return {
        // The episode page URL, which getStreams resolves to an embed.
        episodeLink: episode.url,
        episodeNumber: Math.floor(episode.number),
        episodeTitle: episode.label === "" ? "Episode " + episode.number : episode.label,
        metadata: episode.url,
      };
    });
  },

  async getStreams(input, api) {
    var episodeId = input
      ? String(input.episodeId || input.episodeLink || input.metadata || "")
      : "";
    if (!episodeId) return [];

    var episodeHtml = await body(api, { url: absolute(episodeId) });

    // Prefer the subbed tab; fall back to dubbed when a series only has one.
    var id = embedId(episodeHtml, "subbed-Animegg");
    var server = "AnimeGG-SUB";
    if (!id) {
      id = embedId(episodeHtml, "dubbed-Animegg");
      server = "AnimeGG-DUB";
    }
    if (!id) return [];

    var embedHtml = await body(api, { url: BASE + "/embed/" + id });
    var sources = videoSources(embedHtml);
    if (sources.length === 0) return [];

    var headers = { Referer: BASE + "/", Origin: BASE };

    // Highest quality first; the player takes the first entry it can open.
    sources.sort(function (left, right) {
      return qualityRank(right.label) - qualityRank(left.label);
    });

    var streams = sources.map(function (source) {
      return {
        quality: source.label === "" ? "auto" : source.label,
        url: absolute(source.file),
        server: server,
        backup: false,
        customHeaders: headers,
      };
    });

    // `bk` is a base64 of a second, independent host. It is offered as a backup
    // only when it decodes to HTTPS: the plain-HTTP variants cannot be played
    // by an iOS app under App Transport Security anyway.
    for (var i = 0; i < sources.length; i++) {
      var decoded = base64Decode(sources[i].backup);
      var url = decodeURIComponent(decoded);
      if (url.indexOf("https://") !== 0) continue;
      streams.push({
        quality: sources[i].label === "" ? "auto" : sources[i].label,
        url: url,
        server: server + " backup",
        backup: true,
        customHeaders: headers,
      });
    }

    return streams;
  },
};
