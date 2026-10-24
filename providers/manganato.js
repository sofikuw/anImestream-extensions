/**
 * MangaNato — anImestream Format A *manga* provider.
 *
 *   getChapters({ title, totalChapters }, api)
 *     -> [{ chapterId, chapterNumber, chapterTitle, scanlator }]
 *   getPages({ chapterId }, api)
 *     -> [{ index, url, headers }]
 *
 * MangaNato (the successor to the old Manganato/Mangakakalot network) is plain
 * server-rendered HTML:
 *
 *   1. Search   — GET /search/story/<title with spaces as "_">. Hits are
 *      anchors to /manga/<slug>.
 *   2. Chapters — the manga page lists anchors to /manga/<slug>/chapter-<n>.
 *   3. Pages    — the chapter page holds one <img> per page inside
 *      `.container-chapter-reader`.
 *
 * The network keeps several mirrors and the runtime does not follow redirects,
 * so each mirror in MIRRORS is tried in order until one answers 2xx. Page
 * images are hotlink-checked: they are handed a Referer of the mirror's root.
 */

var MIRRORS = [
  "https://www.manganato.gg",
  "https://manganato.gg",
  "https://www.natomanga.com",
];
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

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function originOf(url) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(url);
  return m ? m[1] : MIRRORS[0];
}

async function get(api, url, referer) {
  var res = await api.request({
    url: url,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Referer": referer || originOf(url) + "/",
    },
  });
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("MangaNato: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("MangaNato: HTTP " + res.statusCode + " for " + url);
  }
  return String(res.body || "");
}

/** Run `path` against each mirror until one works; returns { base, html }. */
async function getFromMirrors(api, path) {
  var lastError = null;
  for (var i = 0; i < MIRRORS.length; i++) {
    try {
      return { base: MIRRORS[i], html: await get(api, MIRRORS[i] + path) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("MangaNato: no mirror answered.");
}

function searchPath(title) {
  var query = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
  return "/search/story/" + encodeURIComponent(query);
}

function collectManga(html, base) {
  var pattern = /<a[^>]+href="((?:https?:\/\/[^"\/]+)?\/manga\/[^"\/?#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var found = [];
  var byUrl = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var path = match[1];
    var url = path.indexOf("http") === 0 ? path : base + path;
    var label = stripTags(match[2]);
    if (!byUrl[url]) {
      byUrl[url] = { url: url, title: "", slug: url.split("/").pop().replace(/-/g, " ") };
      found.push(byUrl[url]);
    }
    if (label !== "" && byUrl[url].title === "") byUrl[url].title = label;
  }
  return found;
}

function pickManga(candidates, title) {
  if (candidates.length === 0) return null;
  var wanted = normalize(title);
  var i;
  for (i = 0; i < candidates.length; i++) {
    if (normalize(candidates[i].title) === wanted || normalize(candidates[i].slug) === wanted) {
      return candidates[i];
    }
  }
  for (i = 0; i < candidates.length; i++) {
    var a = normalize(candidates[i].title);
    var b = normalize(candidates[i].slug);
    if (
      (a !== "" && (a.indexOf(wanted) >= 0 || wanted.indexOf(a) >= 0)) ||
      (b !== "" && (b.indexOf(wanted) >= 0 || wanted.indexOf(b) >= 0))
    ) {
      return candidates[i];
    }
  }
  return candidates[0];
}

function chapterNumber(text, path) {
  var fromText = /chapter\s*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
  var raw = fromText ? fromText[1] : null;
  if (raw === null) {
    var fromPath = /chapter-([0-9]+(?:[.\-][0-9]+)?)/i.exec(path);
    if (fromPath) raw = fromPath[1].replace("-", ".");
  }
  if (raw === null) return undefined;
  var parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chapterTitle(text) {
  var cleaned = String(text).replace(/^chapter\s*[0-9.]+\s*[:\-\u2013]?\s*/i, "").trim();
  // A bare "Chapter 12" label leaves nothing; so does a date-only remainder.
  if (cleaned === "" || /^[A-Za-z]{3}-?\s?\d{1,2},?\s?\d{2,4}/.test(cleaned)) return undefined;
  return cleaned.slice(0, 100);
}

function parseChapters(html, base, mangaUrl) {
  var slug = mangaUrl.replace(/[?#].*$/, "").split("/").pop();
  var pattern = /<a[^>]+href="((?:https?:\/\/[^"\/]+)?\/manga\/([^"\/?#]+)\/chapter-[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var rows = [];
  var seen = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    if (match[2] !== slug) continue;
    var url = match[1].indexOf("http") === 0 ? match[1] : base + match[1];
    if (seen[url]) continue;
    seen[url] = true;
    var label = stripTags(match[3]);
    rows.push({
      url: url,
      number: chapterNumber(label, url),
      title: chapterTitle(label),
    });
  }
  return rows;
}

function parsePages(html, chapterUrl) {
  // Prefer the reader container; fall back to the whole document.
  var marker = html.indexOf("container-chapter-reader");
  var scope = marker >= 0 ? html.slice(marker) : html;

  var pages = [];
  var seen = {};
  var pattern = /<img[^>]*>/g;
  var match;
  while ((match = pattern.exec(scope)) !== null) {
    var tag = match[0];
    var source =
      /data-src="([^"]+)"/.exec(tag) ||
      /data-original="([^"]+)"/.exec(tag) ||
      /src="([^"]+)"/.exec(tag);
    if (!source) continue;
    var url = decodeEntities(source[1]).trim();
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (url.indexOf("http") !== 0) continue;
    if (!/\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?|$)/i.test(url)) continue;
    if (/logo|avatar|icon|banner|loading/i.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    pages.push(url);
  }

  var headers = { Referer: originOf(chapterUrl) + "/" };
  return pages.map(function (url, index) {
    return { index: index, url: url, headers: headers };
  });
}

module.exports = {
  async getChapters(input, api) {
    var title = input && input.title ? String(input.title) : "";
    if (!title) return [];

    var search = await getFromMirrors(api, searchPath(title));
    var manga = pickManga(collectManga(search.html, search.base), title);
    if (!manga) return [];

    var html = await get(api, manga.url);
    var rows = parseChapters(html, originOf(manga.url), manga.url);

    rows.sort(function (left, right) {
      var a = left.number === undefined ? Number.MAX_VALUE : left.number;
      var b = right.number === undefined ? Number.MAX_VALUE : right.number;
      return a - b;
    });

    return rows.map(function (row) {
      return {
        chapterId: row.url,
        chapterNumber: row.number,
        chapterTitle: row.title,
        scanlator: "MangaNato",
      };
    });
  },

  async getPages(input, api) {
    var chapterUrl = input && input.chapterId ? String(input.chapterId) : "";
    if (!chapterUrl) return [];
    if (chapterUrl.indexOf("http") !== 0) chapterUrl = MIRRORS[0] + chapterUrl;
    var html = await get(api, chapterUrl);
    return parsePages(html, chapterUrl);
  },
};
