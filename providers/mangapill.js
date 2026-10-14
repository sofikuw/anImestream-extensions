/**
 * MangaPill — anImestream Format A *manga* provider.
 *
 * Contract (see lib/core/manga/javascriptMangaProvider.dart):
 *
 *   getChapters({ title, totalChapters }, api)
 *     -> [{ chapterId, chapterNumber, chapterTitle, scanlator }]
 *
 *   getPages({ chapterId }, api)
 *     -> [{ url, headers }]   (reading order)
 *
 * No API: MangaPill is plain server-rendered HTML, which is why it is a good
 * second source — nothing here depends on a signed request or a JS engine.
 *
 *   1. Search   — GET /search?q=<title>. Each hit is an anchor to
 *      /manga/<id>/<slug>; the slug IS the title slugified, so candidates are
 *      scored on the slug and no title text has to be parsed out of markup.
 *   2. Chapters — the manga page lists anchors to /chapters/<mangaId>-<n>/<slug>
 *      carrying "Chapter 364.2" as their label.
 *   3. Pages    — the chapter page lazy-loads its images into
 *      `data-src="https://cdn.readdetectiveconan.com/..."`.
 *
 * Only https://mangapill.com goes through api.request; the page images are on a
 * CDN the app fetches itself, and they are handed a Referer because hotlinking
 * that CDN without one is not reliable.
 */

var BASE = "https://mangapill.com";

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

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function body(api, options) {
  var res = await api.request(options);
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("MangaPill: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("MangaPill: HTTP " + res.statusCode + " for " + options.url);
  }
  return res.body;
}

/** Candidate manga pages, in result order, deduplicated. */
function collectManga(html) {
  var pattern = /<a href="(\/manga\/[0-9]+\/[^"]+)"/g;
  var found = [];
  var seen = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var path = match[1];
    if (seen[path]) continue;
    seen[path] = true;
    var slug = path.split("/").pop();
    found.push({ url: BASE + path, slug: slug });
  }
  return found;
}

/**
 * AniList's title is exact and a MangaPill slug is that title lowercased with
 * punctuation collapsed, so an exact slug match is the reliable signal.
 */
function pickManga(candidates, title) {
  if (candidates.length === 0) return null;
  var wanted = normalize(title);
  var i;
  for (i = 0; i < candidates.length; i++) {
    if (normalize(candidates[i].slug) === wanted) return candidates[i];
  }
  for (i = 0; i < candidates.length; i++) {
    var slug = normalize(candidates[i].slug);
    if (slug.indexOf(wanted) >= 0 || wanted.indexOf(slug) >= 0) return candidates[i];
  }
  return candidates[0];
}

function chapterNumber(text, path) {
  var fromText = /chapter\s*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
  var raw = fromText ? fromText[1] : null;
  if (raw === null) {
    var fromPath = /chapter-([0-9]+(?:\.[0-9]+)?)/i.exec(path);
    if (fromPath) raw = fromPath[1];
  }
  if (raw === null) return undefined;
  var parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chapterTitle(text) {
  var cleaned = String(text).replace(/^chapter\s*[0-9.\-]*\s*[:\-\u2013]?\s*/i, "").trim();
  return cleaned === "" ? undefined : cleaned;
}

function parseChapters(html) {
  var pattern = /<a[^>]+href="(\/chapters\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var chapters = [];
  var seen = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var path = match[1];
    var label = stripTags(match[2]);
    if (label === "") continue;
    if (seen[path]) continue;
    seen[path] = true;
    chapters.push({
      url: BASE + path,
      number: chapterNumber(label, path),
      title: chapterTitle(label),
    });
  }
  return chapters;
}

function parsePages(html, chapterUrl) {
  var pages = [];
  var seen = {};
  var pattern = /<img[^>]*>/g;
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var tag = match[0];
    var source = /data-src="([^"]+)"/.exec(tag) || /src="([^"]+)"/.exec(tag);
    if (!source) continue;
    var url = source[1].trim();
    if (url.indexOf("http") !== 0) continue;
    // Site chrome (logo, loading shim) is never a page image.
    if (!/\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    pages.push(url);
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

    var searchHtml = await body(api, {
      url: BASE + "/search?q=" + encodeURIComponent(title),
    });
    var manga = pickManga(collectManga(searchHtml), title);
    if (!manga) return [];

    var page = await body(api, { url: manga.url });
    var chapters = parseChapters(page);

    chapters.sort(function (left, right) {
      var a = left.number === undefined ? Number.MAX_VALUE : left.number;
      var b = right.number === undefined ? Number.MAX_VALUE : right.number;
      return a - b;
    });

    return chapters.map(function (row) {
      return {
        chapterId: row.url,
        chapterNumber: row.number,
        chapterTitle: row.title,
        scanlator: "MangaPill",
      };
    });
  },

  async getPages(input, api) {
    var chapterUrl = input && input.chapterId ? String(input.chapterId) : "";
    if (!chapterUrl) return [];
    if (chapterUrl.indexOf("http") !== 0) chapterUrl = BASE + chapterUrl;
    var html = await body(api, { url: chapterUrl });
    return parsePages(html, chapterUrl);
  },
};
