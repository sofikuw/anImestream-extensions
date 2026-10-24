/**
 * MangaKatana — anImestream Format A *manga* provider.
 *
 *   getChapters({ title, totalChapters }, api)
 *     -> [{ chapterId, chapterNumber, chapterTitle, scanlator }]
 *   getPages({ chapterId }, api)
 *     -> [{ index, url, headers }]
 *
 * Plain server-rendered HTML, no API:
 *
 *   1. Search   — GET /?search=<title>&search_by=book_name. Results are
 *      anchors to /manga/<slug>.<id>. When there is exactly ONE hit the site
 *      answers with a redirect straight to that manga page; the runtime does
 *      not follow redirects, so the Location header is used instead.
 *   2. Chapters — the manga page lists anchors to /manga/<slug>.<id>/c<n>.
 *   3. Pages    — the chapter page keeps its image list in an inline script,
 *      as a JS array of URLs (`var thzq=['https://i1....jpg', ...]`). The
 *      variable name is not stable, so the array is found by its content.
 */

var BASE = "https://mangakatana.com";
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

function headerValue(headers, name) {
  if (!headers) return "";
  var wanted = name.toLowerCase();
  for (var key in headers) {
    if (String(key).toLowerCase() === wanted) {
      var value = headers[key];
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return "";
}

async function fetchPage(api, url, referer) {
  var res = await api.request({
    url: url,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Referer": referer || BASE + "/",
    },
  });
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("MangaKatana: malformed HTTP response.");
  }
  return res;
}

async function body(api, url, referer) {
  var res = await fetchPage(api, url, referer);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("MangaKatana: HTTP " + res.statusCode + " for " + url);
  }
  return String(res.body || "");
}

function mangaTitleFromSlug(url) {
  var last = url.replace(/[?#].*$/, "").split("/").pop() || "";
  return last.replace(/\.[0-9]+$/, "").replace(/-/g, " ");
}

function collectManga(html) {
  var pattern = /<a[^>]+href="((?:https:\/\/mangakatana\.com)?\/manga\/[^"\/]+\.[0-9]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var found = [];
  var byUrl = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var path = match[1];
    var url = path.indexOf("http") === 0 ? path : BASE + path;
    var label = stripTags(match[2]);
    if (!byUrl[url]) {
      byUrl[url] = { url: url, title: "", slug: mangaTitleFromSlug(url) };
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
    var fromPath = /\/c([0-9]+(?:\.[0-9]+)?)(?:[\/?#]|$)/i.exec(path);
    if (fromPath) raw = fromPath[1];
  }
  if (raw === null) return undefined;
  var parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chapterTitle(text) {
  var cleaned = String(text).replace(/^chapter\s*[0-9.]+\s*[:\-\u2013]?\s*/i, "").trim();
  return cleaned === "" ? undefined : cleaned;
}

function parseChapters(html, mangaUrl) {
  var escaped = mangaUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var pattern = new RegExp(
    '<a[^>]+href="(' + escaped + '/c[0-9][^"]*)"[^>]*>([\\s\\S]*?)</a>',
    "g"
  );
  var rows = [];
  var seen = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var url = match[1];
    if (seen[url]) continue;
    seen[url] = true;
    var label = stripTags(match[2]);
    rows.push({
      url: url,
      number: chapterNumber(label, url),
      title: chapterTitle(label),
    });
  }
  return rows;
}

/** The inline image array: the quoted-URL array with the most image links. */
function parsePages(html, chapterUrl) {
  var arrays = /\[\s*(?:'https?:[^\]]*?'|"https?:[^\]]*?")\s*,?\s*\]/g;
  var best = [];
  var match;
  while ((match = arrays.exec(html)) !== null) {
    var urls = [];
    var item = /['"](https?:\/\/[^'"]+)['"]/g;
    var inner;
    while ((inner = item.exec(match[0])) !== null) {
      if (/\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?|$)/i.test(inner[1])) urls.push(inner[1]);
    }
    if (urls.length > best.length) best = urls;
  }

  var seen = {};
  var pages = [];
  for (var i = 0; i < best.length; i++) {
    if (seen[best[i]]) continue;
    seen[best[i]] = true;
    pages.push(best[i]);
  }

  var headers = chapterUrl ? { Referer: chapterUrl } : undefined;
  return pages.map(function (url, index) {
    return { index: index, url: url, headers: headers };
  });
}

module.exports = {
  async getChapters(input, api) {
    var title = input && input.title ? String(input.title) : "";
    if (!title) return [];

    var searchUrl = BASE + "/?search=" + encodeURIComponent(title) + "&search_by=book_name";
    var res = await fetchPage(api, searchUrl);

    var mangaUrl = null;
    var html = "";
    if (res.statusCode >= 300 && res.statusCode < 400) {
      // A single hit redirects straight to the manga page.
      var location = headerValue(res.headers, "location");
      if (location.indexOf("/manga/") >= 0) {
        mangaUrl = location.indexOf("http") === 0 ? location : BASE + location;
      }
    } else if (res.statusCode >= 200 && res.statusCode < 300) {
      html = String(res.body || "");
      var chosen = pickManga(collectManga(html), title);
      if (chosen) mangaUrl = chosen.url;
    } else {
      throw new Error("MangaKatana: HTTP " + res.statusCode + " for " + searchUrl);
    }
    if (!mangaUrl) return [];

    var page = await body(api, mangaUrl);
    var rows = parseChapters(page, mangaUrl.replace(/[?#].*$/, ""));

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
        scanlator: "MangaKatana",
      };
    });
  },

  async getPages(input, api) {
    var chapterUrl = input && input.chapterId ? String(input.chapterId) : "";
    if (!chapterUrl) return [];
    if (chapterUrl.indexOf("http") !== 0) chapterUrl = BASE + chapterUrl;
    var html = await body(api, chapterUrl);
    return parsePages(html, chapterUrl);
  },
};
