/**
 * AnimePahe — anImestream Format A *anime* provider.
 *
 *   search({ query }, api)                  -> [{ name, alias, imageUrl }]
 *   getAnimeEpisodeLink({ aliasId }, api)   -> [{ episodeLink, episodeNumber, episodeTitle, metadata }]
 *   getStreams({ episodeId }, api)          -> [{ quality, url, server, backup, customHeaders }]
 *
 *   1. Search   — GET /api?m=search&q=<query> (JSON). `session` identifies the
 *      anime.
 *   2. Episodes — GET /api?m=release&id=<anime session>&sort=episode_asc&page=N
 *      (JSON, 30 per page). `session` identifies each episode; the play URL is
 *      /play/<anime session>/<episode session>.
 *   3. Streams  — the play page carries one <button data-src="https://kwik…/e/ID"
 *      data-resolution="720" data-audio="jpn"> per quality. Each kwik embed page
 *      holds a Dean-Edwards-packed script that unpacks to `source='…m3u8'`.
 *
 * The site has moved domains repeatedly and the runtime does not follow
 * redirects, so every mirror in MIRRORS is tried in order. Kwik hosts are
 * listed in the manifest for the same reason.
 */

var MIRRORS = ["https://animepahe.si", "https://animepahe.org", "https://animepahe.ru"];
var USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
var MAX_EPISODE_PAGES = 40;
var MAX_QUALITIES = 6;

function decodeEntities(text) {
  return String(text)
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function originOf(url) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(url);
  return m ? m[1] : MIRRORS[0];
}

async function rawGet(api, url, referer, withCookie) {
  var headers = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/html, */*",
    "Referer": referer || originOf(url) + "/",
  };
  // The site sits behind DDoS-Guard, which wants these cookies to be present.
  if (withCookie) headers["Cookie"] = "__ddg1_=;__ddg2_=;";
  var res = await api.request({ url: url, headers: headers });
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("AnimePahe: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("AnimePahe: HTTP " + res.statusCode + " for " + url);
  }
  return String(res.body || "");
}

/** Tries with the DDoS-Guard cookie first, then without if the runtime refuses it. */
async function get(api, url, referer) {
  try {
    return await rawGet(api, url, referer, true);
  } catch (error) {
    if (/HTTP \d+/.test(String(error && error.message))) throw error;
    return rawGet(api, url, referer, false);
  }
}

async function getFromMirrors(api, path) {
  var lastError = null;
  for (var i = 0; i < MIRRORS.length; i++) {
    try {
      return { base: MIRRORS[i], body: await get(api, MIRRORS[i] + path) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("AnimePahe: no mirror answered.");
}

/**
 * Dean Edwards' p.a.c.k.e.r: eval(function(p,a,c,k,e,d){…}('payload',base,count,'a|b|c'.split('|'),0,{}))
 * Returns the unpacked source, or "" when no packed script is present.
 */
function unpack(script) {
  var m = /\}\('((?:[^'\\]|\\[\s\S])*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\[\s\S])*)'\.split\('\|'\)/.exec(script);
  if (!m) return "";
  var payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  var radix = parseInt(m[2], 10);
  var count = parseInt(m[3], 10);
  var words = m[4].split("|");

  function encode(n) {
    return (
      (n < radix ? "" : encode(Math.floor(n / radix))) +
      ((n = n % radix) > 35 ? String.fromCharCode(n + 29) : n.toString(36))
    );
  }

  var table = {};
  while (count--) {
    table[encode(count)] = words[count] || encode(count);
  }
  return payload.replace(/\b\w+\b/g, function (word) {
    return Object.prototype.hasOwnProperty.call(table, word) ? table[word] : word;
  });
}

function extractM3u8(embedHtml) {
  // Several scripts can be on the page; only the packed one holds the source.
  var scripts = embedHtml.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)[\s\S]*?\)\)/g) || [];
  for (var i = 0; i < scripts.length; i++) {
    var unpacked = unpack(scripts[i]);
    var m = /(?:source|file|src)\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i.exec(unpacked) ||
      /(https?:\/\/[^'"\s\\]+\.m3u8[^'"\s\\]*)/i.exec(unpacked);
    if (m) return m[1].replace(/\\\//g, "/");
  }
  var direct = /(https?:\/\/[^'"\s\\]+\.m3u8[^'"\s\\]*)/i.exec(embedHtml);
  return direct ? direct[1] : "";
}

function parseButtons(playHtml) {
  var buttons = [];
  var seen = {};
  var pattern = /<button[^>]*>/g;
  var match;
  while ((match = pattern.exec(playHtml)) !== null) {
    var tag = match[0];
    var src = /data-src="(https?:\/\/[^"]+)"/.exec(tag);
    if (!src) continue;
    var url = decodeEntities(src[1]);
    if (seen[url]) continue;
    seen[url] = true;
    var res = /data-resolution="(\d+)"/.exec(tag);
    var audio = /data-audio="([^"]*)"/.exec(tag);
    buttons.push({
      url: url,
      resolution: res ? parseInt(res[1], 10) : 0,
      audio: audio ? audio[1] : "",
    });
  }
  buttons.sort(function (a, b) {
    return b.resolution - a.resolution;
  });
  return buttons;
}

module.exports = {
  async search(input, api) {
    var query = input && input.query ? String(input.query) : "";
    if (!query) return [];
    var result = await getFromMirrors(api, "/api?m=search&q=" + encodeURIComponent(query));
    var json;
    try {
      json = JSON.parse(result.body);
    } catch (error) {
      throw new Error("AnimePahe: search did not return JSON (blocked by the site?).");
    }
    var rows = (json && json.data) || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || !row.session) continue;
      out.push({
        name: decodeEntities(row.title || row.title_jp || "AnimePahe result"),
        // Full URL on the mirror that answered; getAnimeEpisodeLink gets it back.
        alias: result.base + "/anime/" + row.session,
        imageUrl: row.poster || undefined,
      });
    }
    return out;
  },

  async getAnimeEpisodeLink(input, api) {
    var aliasId = input && input.aliasId ? String(input.aliasId) : "";
    var m = /\/anime\/([^\/?#]+)/.exec(aliasId);
    if (!m) return [];
    var animeSession = m[1];
    var base = originOf(aliasId);

    var episodes = [];
    var seen = {};
    var lastPage = 1;
    for (var page = 1; page <= lastPage && page <= MAX_EPISODE_PAGES; page++) {
      var raw = await get(
        api,
        base + "/api?m=release&id=" + encodeURIComponent(animeSession) + "&sort=episode_asc&page=" + page,
        base + "/anime/" + animeSession
      );
      var json = JSON.parse(raw);
      if (json && json.last_page) lastPage = parseInt(json.last_page, 10) || 1;
      var rows = (json && json.data) || [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row || !row.session || seen[row.session]) continue;
        seen[row.session] = true;
        var number = Number.parseFloat(row.episode);
        if (!Number.isFinite(number)) continue;
        episodes.push({
          episodeLink: base + "/play/" + animeSession + "/" + row.session,
          // The app wants an integer; half-episodes (12.5) are floored and
          // stay distinguishable through episodeLink.
          episodeNumber: Math.floor(number),
          episodeTitle: "Episode " + number,
          metadata: row.session,
        });
      }
    }
    return episodes;
  },

  async getStreams(input, api) {
    var playUrl = input && input.episodeId ? String(input.episodeId) : "";
    if (!playUrl) return [];
    var base = originOf(playUrl);

    var playHtml = await get(api, playUrl, base + "/");
    var buttons = parseButtons(playHtml).slice(0, MAX_QUALITIES);

    var streams = [];
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      try {
        var embed = await get(api, button.url, base + "/");
        var m3u8 = extractM3u8(embed);
        if (!m3u8) continue;
        streams.push({
          quality: button.resolution ? button.resolution + "p" : "auto",
          url: m3u8,
          server: "AnimePahe" + (button.audio ? " (" + button.audio + ")" : ""),
          backup: false,
          customHeaders: {
            Referer: originOf(button.url) + "/",
            Origin: originOf(button.url),
          },
        });
      } catch (error) {
        // One dead quality must not hide the others.
      }
    }
    return streams;
  },
};
