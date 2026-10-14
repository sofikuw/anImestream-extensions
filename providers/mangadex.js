/**
 * MangaDex — anImestream Format A *manga* provider.
 *
 * Contract (see lib/core/manga/javascriptMangaProvider.dart):
 *
 *   getChapters({ title, totalChapters }, api)
 *     -> [{ chapterId, chapterNumber, chapterTitle, scanlator }]
 *
 *   getPages({ chapterId }, api)
 *     -> [{ url }]   (reading order)
 *
 * AniList stays the metadata source; this provider only answers "which chapters
 * exist" and "what images are in this chapter", which is exactly the two things
 * AniList cannot answer.
 *
 * Two requests, both to api.mangadex.org:
 *   1. /manga?title=...        — find the manga by title
 *   2. /manga/{id}/feed?...    — its chapter list
 * and one more for pages:
 *   3. /at-home/server/{id}    — the image host, hash and filenames
 *
 * Page images are NOT fetched through api.request. The reader loads them
 * directly with Image.network, exactly as the player fetches an .mp4 — so the
 * image host does not need to be in allowedHosts. Only api.mangadex.org does,
 * because that is the only host the sandbox ever talks to.
 *
 * Chapters MangaDex hosts elsewhere (`externalUrl`) have no pages here. They
 * are dropped rather than listed, so the chapter list never offers something
 * that cannot actually be opened.
 */

const API = "https://api.mangadex.org";

/** MangaDex needs a language for the feed; English is the widest catalogue. */
const LANGUAGE = "en";

/**
 * `erotica` and `pornographic` are deliberately excluded: the Manga tab is not
 * age-gated, so the provider does not surface what the app cannot gate.
 */
const CONTENT_RATINGS = ["safe", "suggestive"];

function contentRatingQuery() {
  return CONTENT_RATINGS.map(function (rating) {
    return "contentRating[]=" + rating;
  }).join("&");
}

/**
 * Case- and punctuation-insensitive, so "Solo Leveling" matches
 * "Solo-Leveling!" and "나 혼자만 레벨업" stays distinguishable.
 */
function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function collectTitles(attributes) {
  const titles = [];
  const primary = attributes.title || {};
  for (const key in primary) {
    if (primary[key]) titles.push(String(primary[key]));
  }
  const alternates = attributes.altTitles || [];
  for (let i = 0; i < alternates.length; i++) {
    const alternate = alternates[i] || {};
    for (const key in alternate) {
      if (alternate[key]) titles.push(String(alternate[key]));
    }
  }
  return titles;
}

/**
 * MangaDex search is fuzzy and ranks by relevance, which happily returns
 * sequels, spin-offs and same-named titles. AniList's title is exact, so an
 * exact hit on any known title wins; otherwise the top-ranked result is the
 * best available guess.
 */
async function findManga(title, api) {
  const params = [
    "title=" + encodeURIComponent(title),
    "limit=10",
    "order[relevance]=desc",
    contentRatingQuery(),
  ].join("&");

  const res = await api.request({ url: API + "/manga?" + params });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("MangaDex manga search failed with HTTP " + res.statusCode);
  }

  const payload = JSON.parse(res.body);
  const results = payload && payload.data ? payload.data : [];
  if (results.length === 0) return null;

  const wanted = normalize(title);
  for (let i = 0; i < results.length; i++) {
    const attributes = results[i].attributes || {};
    const titles = collectTitles(attributes);
    for (let j = 0; j < titles.length; j++) {
      if (normalize(titles[j]) === wanted) return results[i];
    }
  }
  return results[0];
}

/** The scanlation group is inlined because the request asks for it. */
function scanlationGroup(entry) {
  const relationships = entry.relationships || [];
  for (let i = 0; i < relationships.length; i++) {
    const relationship = relationships[i];
    if (
      relationship.type === "scanlation_group" &&
      relationship.attributes &&
      relationship.attributes.name
    ) {
      return String(relationship.attributes.name);
    }
  }
  return undefined;
}

/**
 * MangaDex stores chapter numbers as strings and leaves them empty for one-shots
 * and extras. `undefined` lets the app fall back to its own "Chapter" label
 * instead of inventing a number.
 */
function chapterNumber(attributes) {
  const raw = attributes.chapter;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return undefined;
  }
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

module.exports = {
  async getChapters(input, api) {
    const title = input && input.title ? String(input.title) : "";
    if (!title) return [];

    const manga = await findManga(title, api);
    if (!manga) return [];

    const params = [
      "translatedLanguage[]=" + LANGUAGE,
      "order[chapter]=asc",
      "limit=500",
      "includes[]=scanlation_group",
      contentRatingQuery(),
    ].join("&");

    const res = await api.request({
      url: API + "/manga/" + encodeURIComponent(manga.id) + "/feed?" + params,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error("MangaDex chapter feed failed with HTTP " + res.statusCode);
    }

    const payload = JSON.parse(res.body);
    const data = payload && payload.data ? payload.data : [];

    const chapters = [];
    const seen = {};
    for (let i = 0; i < data.length; i++) {
      const entry = data[i];
      const attributes = entry.attributes || {};

      // Hosted off MangaDex: listed but unreadable, so not listed at all.
      if (attributes.externalUrl) continue;
      if (seen[entry.id]) continue;
      seen[entry.id] = true;

      const number = chapterNumber(attributes);
      const sourceTitle = attributes.title ? String(attributes.title).trim() : "";

      chapters.push({
        chapterId: entry.id,
        chapterNumber: number,
        // Left undefined when MangaDex has no title of its own, so the app's
        // "Chapter 12" / "Chapter 12.5" formatting is used instead.
        chapterTitle: sourceTitle === "" ? undefined : sourceTitle,
        scanlator: scanlationGroup(entry),
      });
    }

    // The feed is ordered, but numbers can be missing (extras), which would
    // otherwise land them in the middle of the list.
    chapters.sort(function (left, right) {
      const a = left.chapterNumber === undefined ? Number.MAX_VALUE : left.chapterNumber;
      const b = right.chapterNumber === undefined ? Number.MAX_VALUE : right.chapterNumber;
      return a - b;
    });

    return chapters;
  },

  async getPages(input, api) {
    const chapterId = input && input.chapterId ? String(input.chapterId) : "";
    if (!chapterId) return [];

    const res = await api.request({
      url: API + "/at-home/server/" + encodeURIComponent(chapterId),
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error("MangaDex page list failed with HTTP " + res.statusCode);
    }

    const payload = JSON.parse(res.body);
    const chapter = payload ? payload.chapter : null;
    if (!payload || !payload.baseUrl || !chapter || !chapter.hash) return [];

    // `data` is the original quality set; `dataSaver` is the compressed one.
    // Only fall back when the original is empty, never mix the two.
    let directory = "data";
    let files = chapter.data || [];
    if (files.length === 0) {
      directory = "data-saver";
      files = chapter.dataSaver || [];
    }

    const pages = [];
    for (let i = 0; i < files.length; i++) {
      pages.push({
        index: i,
        url: payload.baseUrl + "/" + directory + "/" + chapter.hash + "/" + files[i],
      });
    }
    return pages;
  },
};
