/**
 * Ragnarok Scanlation — anImestream Format A *manga* provider.
 *
 * Contract (see lib/core/manga/javascriptMangaProvider.dart):
 *
 *   getChapters({ title, totalChapters }, api)
 *     -> [{ chapterId, chapterNumber, chapterTitle, scanlator }]
 *
 *   getPages({ chapterId }, api)
 *     -> [{ url, headers }]   (reading order)
 *
 * AniList stays the metadata source. This provider answers the two questions
 * AniList cannot: which chapters exist, and what images are in one of them.
 *
 * The site is a WordPress/Madara install, so there is no JSON API anywhere and
 * three different mechanisms have to be used, one per stage:
 *
 *   1. Find the series  — GET /?s=<title>&post_type=wp-manga is a server
 *      rendered search page. Every hit is a `.c-tabs-item__content` block whose
 *      series anchor is /series/<slug>/ with the title in `title=`. The same
 *      block also carries a *chapter* anchor (the latest release), so the
 *      series link is matched with a path that has no /chapter- in it.
 *   2. List the chapters — the series page ships a spinner and fills
 *      `#manga-chapters-holder` from JS. madara-core's script.js does:
 *          url: manga.base_url + 'ajax/chapters/?t=' + page
 *      i.e. a POST to <seriesUrl>/ajax/chapters/?t=1 returning chapter-list
 *      HTML. (The theme's wp-admin/admin-ajax.php `ajax_chapters` action is NOT
 *      registered on this install — it answers 400 "0" — so it must not be
 *      used.) Pages are read until one yields no new chapters.
 *   3. Read a chapter — the chapter page server-renders its images as
 *      `class="wp-manga-chapter-img"`, with a leading space inside `src`.
 *
 * Only https://ragnarokscanlation.org is ever requested through api.request.
 * The images live on that same host, so they are fetched by the app directly
 * and still need the manifest host; the Referer header is sent anyway because
 * the CDN path is hotlink-checked in practice.
 */

var BASE = "https://ragnarokscanlation.org";

/** Madara caps its chapter-list pages; three is well past every series here. */
var MAX_CHAPTER_PAGES = 3;

function decodeEntities(text) {
  return String(text)
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(text) {
  return decodeEntities(String(text).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Case- and punctuation-insensitive, so "Solo Leveling" matches "Solo-Leveling!". */
function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function body(api, options) {
  var res = await api.request(options);
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("Ragnarok Scanlation: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("Ragnarok Scanlation: HTTP " + res.statusCode + " for " + options.url);
  }
  return res.body;
}

/** Every series hit on a search page, in the order the site ranked them. */
function collectSeries(html) {
  var pattern = /<a href="(https:\/\/ragnarokscanlation\.org\/series\/[^"\/]+\/)"[^>]*title="([^"]*)"/g;
  var found = [];
  var seen = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var url = match[1];
    if (seen[url]) continue;
    seen[url] = true;
    found.push({ url: url, title: decodeEntities(match[2]) });
  }
  return found;
}

/**
 * Madara search ranks by relevance and happily returns sequels and same-named
 * series. AniList's title is exact, so an exact hit wins; otherwise the closest
 * contains-match; otherwise the top-ranked hit is the best guess available.
 */
function pickSeries(candidates, title) {
  if (candidates.length === 0) return null;
  var wanted = normalize(title);
  var i;
  for (i = 0; i < candidates.length; i++) {
    if (normalize(candidates[i].title) === wanted) return candidates[i];
  }
  for (i = 0; i < candidates.length; i++) {
    var candidate = normalize(candidates[i].title);
    if (candidate.indexOf(wanted) >= 0 || wanted.indexOf(candidate) >= 0) return candidates[i];
  }
  return candidates[0];
}

/**
 * "Chapter 364.2", "chapter-364-part-2" and "Chapter 81 - Colour" all have to
 * yield a number, because the app sorts on it. A part/extra suffix is folded
 * into a decimal ("364-part-2" -> 364.2) rather than dropped, so two releases
 * of the same chapter do not collapse onto one position.
 */
function chapterNumber(text, path) {
  var raw = null;
  var fromText = /chapter\s*([0-9]+(?:[.\-][0-9]+)?)/i.exec(text);
  if (fromText) raw = fromText[1];
  if (raw === null) {
    var fromPath = /chapter-([0-9]+(?:\.[0-9]+)?)/i.exec(path);
    if (fromPath) raw = fromPath[1];
  }
  if (raw === null) return undefined;
  var parsed = Number.parseFloat(String(raw).replace("-", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The chapter's own name, with the "Chapter N" prefix removed. The site writes
 * some releases as "Chapter 364, Part 2", so any separator left dangling after
 * the number is stripped too — otherwise a row reads "Chapter 364: , Part 2".
 */
function chapterTitle(text) {
  var cleaned = String(text)
    .replace(/^chapter\s*[0-9.\-]*\s*/i, "")
    .replace(/^[\s,:\-\u2013]+/, "")
    .trim();
  return cleaned === "" ? undefined : cleaned;
}

/**
 * One row per chapter anchor in an `ajax/chapters/?t=N` fragment.
 *
 * Anchors are matched structurally rather than by class: this theme wraps rows
 * in `.wp-manga-chapter` markup, but the anchor is what carries both the URL
 * and the label, and both survive a theme's wrapper changing.
 */
function parseChapterFragment(html) {
  var pattern = /<a[^>]+href="([^"]*\/series\/[^"\/]+\/chapter-[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  var chapters = [];
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var path = match[1];
    var label = stripTags(match[2]);
    var url = path.indexOf("http") === 0 ? path : BASE + path;
    chapters.push({
      url: url,
      number: chapterNumber(label, path),
      title: chapterTitle(label),
    });
  }
  return chapters;
}

/**
 * The image list of a chapter page.
 *
 * `data-src` wins over `src` when both are present: Madara lazy-loads, so the
 * `src` is a placeholder until the reader scrolls. The `src` in this install
 * also arrives with a leading space, which is trimmed.
 */
function parsePages(html, chapterUrl) {
  var pages = [];
  var seen = {};
  var tagPattern = /<img[^>]*>/g;
  var match;
  while ((match = tagPattern.exec(html)) !== null) {
    var tag = match[0];
    if (tag.indexOf("wp-manga-chapter-img") < 0 && tag.indexOf("reading-content") < 0) {
      // Chapter images are marked; anything else on the page is site chrome.
      var marked = /wp-content\/uploads\/WP-manga\/data\//.test(tag);
      if (!marked) continue;
    }
    var source = /data-src="([^"]+)"/.exec(tag) || /src="([^"]+)"/.exec(tag);
    if (!source) continue;
    var url = source[1].trim();
    if (url.indexOf("http") !== 0) continue;
    if (seen[url]) continue;
    seen[url] = true;
    pages.push(url);
  }

  // Fallback: some Madara builds strip the img wrappers and leave the data
  // paths in an inline script instead.
  if (pages.length === 0) {
    var pathPattern = /https:\/\/ragnarokscanlation\.org\/wp-content\/uploads\/WP-manga\/data\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/g;
    var found;
    while ((found = pathPattern.exec(html)) !== null) {
      if (seen[found[0]]) continue;
      seen[found[0]] = true;
      pages.push(found[0]);
    }
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
      url: BASE + "/?s=" + encodeURIComponent(title) + "&post_type=wp-manga",
    });
    var series = pickSeries(collectSeries(searchHtml), title);
    if (!series) return [];

    var collected = [];
    var seen = {};
    for (var page = 1; page <= MAX_CHAPTER_PAGES; page++) {
      var html = await body(api, {
        url: series.url + "ajax/chapters/?t=" + page,
        method: "POST",
      });
      var rows = parseChapterFragment(html);
      var added = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (seen[row.url]) continue;
        seen[row.url] = true;
        collected.push(row);
        added++;
      }
      if (added === 0) break;
    }

    // Newest first on the site; the app renders oldest first and sorts on the
    // number anyway, but rows without one (extras) must not land in the middle.
    collected.sort(function (left, right) {
      var a = left.number === undefined ? Number.MAX_VALUE : left.number;
      var b = right.number === undefined ? Number.MAX_VALUE : right.number;
      return a - b;
    });

    return collected.map(function (row) {
      return {
        // The full chapter URL: getPages receives this back verbatim.
        chapterId: row.url,
        chapterNumber: row.number,
        chapterTitle: row.title,
        scanlator: "Ragnarok Scanlation",
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
