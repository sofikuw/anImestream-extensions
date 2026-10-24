/**
 * AniZone — anImestream Format A *anime* provider.
 *
 *   search({ query }, api)                  -> [{ name, alias, imageUrl }]
 *   getAnimeEpisodeLink({ aliasId }, api)   -> [{ episodeLink, episodeNumber, episodeTitle, metadata }]
 *   getStreams({ episodeId }, api)          -> [{ quality, url, server, backup, customHeaders }]
 *
 * AniZone is server-rendered (Laravel/Livewire) and serves a plain HLS master
 * playlist straight in the page, so no stream extractor is involved:
 *
 *   1. Search   — GET /anime?search=<query>; hits are anchors to /anime/<id>.
 *   2. Episodes — the anime page lists anchors to /anime/<id>/<number>.
 *   3. Streams  — the episode page's <media-player> element carries
 *      src="https://…/master.m3u8".
 *
 * The page images (posters) are fetched by the app, not through api.request.
 */

var BASE = "https://anizone.to";
var USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

function decodeEntities(text) {
  return String(text)
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
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

async function get(api, url, referer) {
  var res = await api.request({
    url: url,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Referer": referer || BASE + "/",
    },
  });
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("AniZone: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("AniZone: HTTP " + res.statusCode + " for " + url);
  }
  return String(res.body || "");
}

function absolute(url) {
  if (url.indexOf("http") === 0) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  return BASE + (url.charAt(0) === "/" ? url : "/" + url);
}

function parseSearch(html) {
  var pattern = /<a\b([^>]*?)href="((?:https:\/\/anizone\.to)?\/anime\/[A-Za-z0-9]+)"([^>]*)>([\s\S]*?)<\/a>/g;
  var order = [];
  var byUrl = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var url = absolute(match[2]);
    var attrs = match[1] + " " + match[3];
    var titleAttr = /\btitle="([^"]+)"/.exec(attrs);
    var label = titleAttr ? decodeEntities(titleAttr[1]) : stripTags(match[4]);
    var img = /<img[^>]+src="([^"]+)"/.exec(match[4]);
    if (!byUrl[url]) {
      byUrl[url] = { name: "", imageUrl: undefined };
      order.push(url);
    }
    if (label !== "" && byUrl[url].name === "") byUrl[url].name = label;
    if (img && !byUrl[url].imageUrl) byUrl[url].imageUrl = absolute(decodeEntities(img[1]));
  }
  return order
    .filter(function (url) {
      return byUrl[url].name !== "";
    })
    .map(function (url) {
      return { name: byUrl[url].name, alias: url, imageUrl: byUrl[url].imageUrl };
    });
}

function parseEpisodes(html, animeUrl) {
  var id = animeUrl.replace(/[?#].*$/, "").split("/").pop();
  var pattern = new RegExp(
    '<a\\b[^>]*href="((?:https://anizone\\.to)?/anime/' + id + '/(\\d+))"[^>]*>([\\s\\S]*?)</a>',
    "g"
  );
  var rows = [];
  var seen = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var number = parseInt(match[2], 10);
    if (seen[number]) continue;
    seen[number] = true;
    var label = stripTags(match[3]);
    // "Episode 3 The Name" -> "The Name"; a bare label carries no extra name.
    var name = label.replace(/^(?:episode|ep\.?)\s*\d+\s*[:\-\u2013]?\s*/i, "").trim();
    rows.push({
      episodeLink: absolute(match[1]),
      episodeNumber: number,
      episodeTitle: name !== "" && name !== label ? "Episode " + number + " - " + name : "Episode " + number,
      metadata: String(number),
    });
  }
  rows.sort(function (a, b) {
    return a.episodeNumber - b.episodeNumber;
  });
  return rows;
}

function parseStreams(html) {
  var urls = [];
  var seen = {};
  function add(url) {
    url = decodeEntities(url).replace(/\\\//g, "/");
    if (seen[url]) return;
    seen[url] = true;
    urls.push(url);
  }

  var player = /<media-player\b[^>]*\bsrc="([^"]+)"/i.exec(html);
  if (player) add(player[1]);
  var source = /<source\b[^>]*\bsrc="([^"]+\.m3u8[^"]*)"/i.exec(html);
  if (source) add(source[1]);
  var generic = /(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/g;
  var m;
  while ((m = generic.exec(html)) !== null) add(m[1]);

  return urls
    .filter(function (url) {
      return /\.m3u8/i.test(url) || /\.mp4/i.test(url);
    })
    .map(function (url) {
      return absolute(url);
    });
}

module.exports = {
  async search(input, api) {
    var query = input && input.query ? String(input.query) : "";
    if (!query) return [];
    var html = await get(api, BASE + "/anime?search=" + encodeURIComponent(query));
    return parseSearch(html);
  },

  async getAnimeEpisodeLink(input, api) {
    var aliasId = input && input.aliasId ? String(input.aliasId) : "";
    if (!aliasId) return [];
    var html = await get(api, aliasId);
    return parseEpisodes(html, aliasId);
  },

  async getStreams(input, api) {
    var episodeUrl = input && input.episodeId ? String(input.episodeId) : "";
    if (!episodeUrl) return [];
    var html = await get(api, episodeUrl);
    var urls = parseStreams(html);
    return urls.map(function (url, index) {
      return {
        quality: "auto",
        url: url,
        server: "AniZone",
        backup: index > 0,
        customHeaders: { Referer: BASE + "/", Origin: BASE },
      };
    });
  },
};
