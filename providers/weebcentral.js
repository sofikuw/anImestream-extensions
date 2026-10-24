/**
 * WeebCentral — anImestream Format A *manga* provider.
 *
 *   getChapters({ title, totalChapters }, api)
 *     -> [{ chapterId, chapterNumber, chapterTitle, scanlator }]
 *   getPages({ chapterId }, api)
 *     -> [{ index, url, headers }]
 *
 * WeebCentral is server-rendered with HTMX, so every stage is a plain HTML
 * fragment endpoint (no JSON, no signed requests):
 *
 *   1. Search   — GET /search/data?text=<title>&... returns result cards; each
 *      links to /series/<ULID>/<Slug>. The slug is the title, so candidates are
 *      scored on it.
 *   2. Chapters — GET /series/<ULID>/full-chapter-list returns EVERY chapter
 *      as an anchor to /chapters/<ULID> (no pagination).
 *   3. Pages    — GET /chapters/<ULID>/images?reading_style=long_strip returns
 *      one <img> per page.
 *
 * Only https://weebcentral.com goes through api.request. Page images sit on a
 * CDN the app fetches itself, with the chapter URL as Referer.
 */

var BASE = "https://weebcentral.com";
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

async function body(api, url, referer) {
  var res = await api.request({
    url: url,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html, */*",
      "HX-Request": "true",
      "Referer": referer || BASE + "/",
    },
  });
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("WeebCentral: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("WeebCentral: HTTP " + res.statusCode + " for " + url);
  }
  return String(res.body || "");
}

/** Series hits in ranked order, one row per series id. */
function collectSeries(html) {
  var pattern = /<a[^>]+href="(?:https:\/\/weebcentral\.com)?\/series\/([0-9A-Za-z]{20,32})\/([^"?#]*)"[^>]*>([\s\S]*?)<\/a>/g;
  var order = [];
  var byId = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var id = match[1];
    var slug = decodeURIComponent(match[2] || "").replace(/-/g, " ");
    var label = stripTags(match[3]);
    if (!byId[id]) {
      byId[id] = { id: id, slug: slug, title: "" };
      order.push(id);
    }
    if (label !== "" && byId[id].title === "") byId[id].title = label;
  }
  return order.map(function (id) {
    var row = byId[id];
    return { id: row.id, name: row.title || row.slug, slug: row.slug };
  });
}

function pickSeries(candidates, title) {
  if (candidates.length === 0) return null;
  var wanted = normalize(title);
  var i;
  for (i = 0; i < candidates.length; i++) {
    if (normalize(candidates[i].slug) === wanted || normalize(candidates[i].name) === wanted) {
      return candidates[i];
    }
  }
  for (i = 0; i < candidates.length; i++) {
    var a = normalize(candidates[i].slug);
    var b = normalize(candidates[i].name);
    if (
      (a !== "" && (a.indexOf(wanted) >= 0 || wanted.indexOf(a) >= 0)) ||
      (b !== "" && (b.indexOf(wanted) >= 0 || wanted.indexOf(b) >= 0))
    ) {
      return candidates[i];
    }
  }
  return candidates[0];
}

function chapterNumber(label) {
  var m = /(?:chapter|episode|ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(label);
  if (!m) return undefined;
  var n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function chapterTitle(label, number) {
  if (number !== undefined) return undefined; // "Chapter N" carries no extra name here.
  var cleaned = label.replace(/\d{4}-\d{2}-\d{2}.*$/, "").trim();
  return cleaned === "" ? undefined : cleaned.slice(0, 80);
}

function parseChapters(html) {
  var pattern = /<a[^>]+href="((?:https:\/\/weebcentral\.com)?\/chapters\/[0-9A-Za-z]+)"[^>]*>([\s\S]*?)<\/a>/g;
  var rows = [];
  var seen = {};
  var match;
  while ((match = pattern.exec(html)) !== null) {
    var path = match[1];
    var url = path.indexOf("http") === 0 ? path : BASE + path;
    if (seen[url]) continue;
    seen[url] = true;
    var label = stripTags(match[2]);
    var number = chapterNumber(label);
    rows.push({ url: url, number: number, title: chapterTitle(label, number) });
  }
  return rows;
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
    var url = decodeEntities(source[1]).trim();
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (url.indexOf("http") !== 0) continue;
    if (!/\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?|$)/i.test(url)) continue;
    // Site chrome (brand/static assets) is never a page.
    if (/\/static\/|brand|logo|avatar/i.test(url)) continue;
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

    var searchUrl =
      BASE +
      "/search/data?limit=32&offset=0&text=" +
      encodeURIComponent(title) +
      "&sort=Best+Match&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Minimal+Display";
    var series = pickSeries(collectSeries(await body(api, searchUrl)), title);
    if (!series) return [];

    var html = await body(api, BASE + "/series/" + series.id + "/full-chapter-list");
    var rows = parseChapters(html);

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
        scanlator: "WeebCentral",
      };
    });
  },

  async getPages(input, api) {
    var chapterUrl = input && input.chapterId ? String(input.chapterId) : "";
    if (!chapterUrl) return [];
    if (chapterUrl.indexOf("http") !== 0) chapterUrl = BASE + chapterUrl;
    var html = await body(
      api,
      chapterUrl + "/images?is_prev=False&current_page=1&reading_style=long_strip",
      chapterUrl
    );
    return parsePages(html, chapterUrl);
  },
};
