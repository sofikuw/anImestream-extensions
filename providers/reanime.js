/**
 * Re:ANIME — anImestream Format A anime provider.
 *
 * Ported from the in-app ReAnime provider. The site exposes a small JSON API
 * on reanime.to; playback is handed off to FlixCloud, which returns a ready
 * MKV download URL plus optional subtitles.
 *
 * The API returns an AniList id for each title, and the stream endpoint is
 * keyed by that id plus the episode number. Episodes carry the alias, number
 * and AniList id in `metadata` so `getStreams` does not need another lookup.
 *
 * FlixCloud load-balances its media hosts as fetch1.flixcloud.cc through
 * fetch20.flixcloud.cc, so those hosts are allowlisted explicitly. The
 * manifest format does not support wildcards.
 *
 * ES5-style objects and functions throughout: this runs inside QuickJS, and
 * the runtime exposes only `api.request`, not timers or DOM APIs.
 */

var BASE = "https://reanime.to";
var API = BASE + "/api/v1";
var FLIX = "https://flixcloud.cc";
var USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

var UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
var JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
var FETCH_BASE_PATTERN = /https:\/\/fetch\d*\.flixcloud\.cc(?=["\/])/;
var RESOLUTION_PATTERN = /(\d{3,4}p)/;

function headers(referer) {
  return {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Referer": referer || BASE + "/"
  };
}

async function getText(api, url, requestHeaders) {
  var response = await api.request({
    url: url,
    headers: requestHeaders || headers()
  });
  if (!response || typeof response.statusCode !== "number") {
    throw new Error("Re:ANIME: malformed HTTP response");
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error("Re:ANIME: HTTP " + response.statusCode + " for " + url);
  }
  return String(response.body || "");
}

async function getJson(api, url, requestHeaders) {
  return JSON.parse(await getText(api, url, requestHeaders));
}

function nonEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function titleOf(title) {
  if (!title || typeof title !== "object") return "";
  return (
    nonEmpty(title.english) ||
    nonEmpty(title.romaji) ||
    nonEmpty(title.native)
  );
}

function coverOf(cover) {
  if (!cover || typeof cover !== "object") return null;
  return nonEmpty(cover.extra_large) || nonEmpty(cover.large) || nonEmpty(cover.medium) || null;
}

function normalizeFormat(format) {
  var upper = nonEmpty(format).toUpperCase();
  if (upper === "ASS") return "ASS";
  if (upper === "SRT") return "SRT";
  return "VTT";
}

/**
 * The embed page writes its subtitle list as `subtitles: [{url:"…",
 * language:"…", format:"…", default:true}, …]`. There is no JSON parser for
 * that fragment, so pull out the fields the app needs.
 */
function pickSubtitle(html, isDub) {
  var blockMatch = /subtitles:\s*(\[[\s\S]*?\])\s*,/.exec(String(html || ""));
  if (!blockMatch) return null;

  var itemPattern =
    /\{url:\s*"([^"]+)"\s*,\s*language:\s*"([^"]+)"\s*,\s*format:\s*"([^"]+)"(?:,\s*default:\s*(true|false))?/g;
  var items = [];
  var match;
  while ((match = itemPattern.exec(blockMatch[1])) !== null) {
    var language = match[2].toLowerCase();
    if (language.indexOf("english") < 0) continue;
    items.push({
      url: match[1],
      language: language,
      format: normalizeFormat(match[3]),
      isDefault: match[4] === "true"
    });
  }
  if (items.length === 0) return null;

  var i;
  if (isDub) {
    // Spoken English is already in the dub; only signs/songs and dubtitles
    // make sense to attach.
    for (i = 0; i < items.length; i++) {
      var forced = items[i].language;
      if (forced.indexOf("sign") >= 0 || forced.indexOf("song") >= 0 || forced.indexOf("forced") >= 0) {
        return { url: items[i].url, format: items[i].format };
      }
    }
    for (i = 0; i < items.length; i++) {
      if (items[i].language.indexOf("dubtitle") >= 0) {
        return { url: items[i].url, format: items[i].format };
      }
    }
    return null;
  }

  for (i = 0; i < items.length; i++) {
    var lang = items[i].language;
    if ((lang.indexOf("dialog") >= 0 || lang.indexOf("full") >= 0) && lang.indexOf("dubtitle") < 0) {
      return { url: items[i].url, format: items[i].format };
    }
  }
  for (i = 0; i < items.length; i++) {
    if (items[i].isDefault && items[i].language.indexOf("dubtitle") < 0) {
      return { url: items[i].url, format: items[i].format };
    }
  }
  for (i = 0; i < items.length; i++) {
    if (items[i].language.indexOf("dubtitle") < 0) {
      return { url: items[i].url, format: items[i].format };
    }
  }
  return { url: items[0].url, format: items[0].format };
}

/**
 * Resolve one FlixCloud embed into an MKV stream. The __data.json file holds
 * the file id, JWT and media host; the embed page holds the English subtitle.
 */
async function extractStream(api, dataLink, label, isDub) {
  var aidMatch = /\/e\/([a-z0-9]+)/i.exec(String(dataLink || ""));
  if (!aidMatch) return null;
  var aid = aidMatch[1];

  var dlHeaders = {
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Origin": FLIX,
    "Referer": FLIX + "/"
  };

  var responses = await Promise.all([
    getText(api, FLIX + "/d/" + aid + "/__data.json", dlHeaders),
    getText(api, dataLink, dlHeaders).catch(function () {
      return "";
    })
  ]);
  var meta = responses[0];
  var embed = responses[1];

  var fileIdMatch = UUID_PATTERN.exec(meta);
  var tokenMatch = JWT_PATTERN.exec(meta);
  var baseMatch = FETCH_BASE_PATTERN.exec(meta);
  var resolutionMatch = RESOLUTION_PATTERN.exec(meta);
  if (!fileIdMatch || !tokenMatch) return null;

  var fileId = fileIdMatch[0];
  var token = tokenMatch[0];
  var base = baseMatch ? baseMatch[0] : FLIX;
  var resolution = resolutionMatch ? resolutionMatch[1] : "1080p";
  var subtitle = pickSubtitle(embed, isDub);

  // The progress endpoint is what warms FlixCloud's cache. The runtime has no
  // timer, but each round-trip gives the backend a little time; three checks
  // are enough for the files this source serves.
  var ready = false;
  var attempt;
  for (attempt = 0; attempt < 3; attempt++) {
    try {
      var progress = await getText(
        api,
        base + "/download/" + fileId + "/progress?token=" + encodeURIComponent(token),
        dlHeaders
      );
      if (/"status"\s*:\s*"ready"/.test(progress)) {
        ready = true;
        break;
      }
    } catch (error) {
      // Try again until the attempts are exhausted.
    }
  }
  if (!ready) return null;

  return {
    quality: resolution,
    url: base + "/download/" + fileId + "?token=" + encodeURIComponent(token) + "&file=.mkv",
    server: label + " [MKV]",
    backup: false,
    subtitle: subtitle ? subtitle.url : null,
    subtitleFormat: subtitle ? subtitle.format : null,
    customHeaders: {
      "Origin": FLIX,
      "Referer": FLIX + "/"
    }
  };
}

module.exports = {
  async search(input, api) {
    var query = input && input.query ? String(input.query) : "";
    if (!query) return [];

    var json = await getJson(
      api,
      API + "/search?limit=10&typeahead=1&q=" + encodeURIComponent(query),
      headers()
    );
    var results = json && Array.isArray(json.results) ? json.results : [];
    var output = [];
    var i;
    for (i = 0; i < results.length; i++) {
      var item = results[i];
      var name = titleOf(item && item.title);
      var alias = item && nonEmpty(item.anime_id);
      if (!name || !alias) continue;
      output.push({
        name: name,
        alias: alias,
        imageUrl: coverOf(item.cover_image)
      });
    }
    return output;
  },

  async getAnimeEpisodeLink(input, api) {
    var aliasId = input && input.aliasId ? String(input.aliasId) : "";
    if (!aliasId) return [];

    var anilistId = "";
    try {
      var detail = await getJson(api, API + "/anime/" + encodeURIComponent(aliasId), headers());
      anilistId = nonEmpty(detail && detail.anilist_id);
    } catch (error) {
      // Episode lookup can still work when details are unavailable.
    }

    var json = await getJson(
      api,
      API + "/anime/" + encodeURIComponent(aliasId) + "/episodes?limit=2000",
      headers()
    );
    var episodes = json && Array.isArray(json.data) ? json.data : [];
    var output = [];
    var i;
    for (i = 0; i < episodes.length; i++) {
      var episode = episodes[i];
      var number = Number(episode && episode.episode_number);
      if (!Number.isFinite(number)) continue;

      var isDub = episode.dubbed === true;
      if (input && input.dub && !isDub) continue;

      var episodeId = nonEmpty(episode.episodeId) || nonEmpty(episode.url);
      if (!episodeId) continue;

      var metadata = aliasId + "|" + number;
      if (anilistId) metadata += "|" + anilistId;

      var thumbnail = nonEmpty(episode.thumbnail);
      output.push({
        episodeLink: episodeId,
        episodeNumber: Math.floor(number),
        episodeTitle: nonEmpty(episode.title) || "Episode " + number,
        thumbnail: thumbnail || null,
        hasDub: isDub,
        isFiller: episode.is_filler === true,
        metadata: metadata
      });
    }
    return output;
  },

  async getStreams(input, api) {
    var episodeId = input && input.episodeId ? String(input.episodeId) : "";
    if (!episodeId) return [];

    var parts = input && input.metadata ? String(input.metadata).split("|") : [];
    var animeId = parts.length > 0 && parts[0] ? parts[0] : episodeId;
    var episodeNumber = parts.length > 1 && parts[1] ? parts[1] : "1";
    var anilistId = parts.length > 2 ? parts[2] : "";

    if (!anilistId) {
      if (/^[0-9]+$/.test(animeId)) {
        anilistId = animeId;
      } else {
        try {
          var detail = await getJson(api, API + "/anime/" + encodeURIComponent(animeId), headers());
          anilistId = nonEmpty(detail && detail.anilist_id);
        } catch (error) {
          return [];
        }
      }
    }
    if (!anilistId) return [];

    var flixHeaders = {
      "User-Agent": USER_AGENT,
      "Accept": "application/json, text/plain, */*",
      "Referer": BASE + "/watch/" + animeId + "?ep=" + episodeNumber,
      "Origin": BASE
    };
    var json = await getJson(
      api,
      BASE + "/api/flix/" + encodeURIComponent(anilistId) + "/" + encodeURIComponent(episodeNumber),
      flixHeaders
    );
    var servers = json && Array.isArray(json.servers) ? json.servers : [];
    var isDub = !!(input && input.dub);

    var links = [];
    var seen = {};
    var i;
    for (i = 0; i < servers.length; i++) {
      var server = servers[i];
      var dataType = nonEmpty(server.dataType).toLowerCase();
      if (isDub ? dataType !== "dub" : dataType === "dub") continue;

      var dataLink = nonEmpty(server.dataLink);
      if (!dataLink || seen[dataLink]) continue;
      seen[dataLink] = true;
      links.push({
        dataLink: dataLink,
        label: nonEmpty(server.serverName) || "FlixCloud"
      });
      if (links.length >= 4) break;
    }

    var streams = await Promise.all(
      links.map(function (link) {
        return extractStream(api, link.dataLink, link.label, isDub).catch(function () {
          return null;
        });
      })
    );

    // v=1 and v=2 often resolve to the same file id. Keep one entry per
    // actual stream instead of listing the same MKV twice.
    var seenStreams = {};
    return streams.filter(function (stream) {
      if (stream === null) return false;
      var key = stream.url.replace(/\?.*$/, "");
      if (seenStreams[key]) return false;
      seenStreams[key] = true;
      return true;
    });
  },

  async getDownloadSources(input, api) {
    return module.exports.getStreams(input, api);
  }
};
