var BASE = "https://animeyy.com";

async function get(api, url) {
  var res = await api.request({ url: url, headers: { Referer: BASE } });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("AnimeZZ: HTTP " + (res && res.statusCode));
  }
  return res.body;
}

function text(html) {
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(url) {
  if (!url) return "";
  if (url.indexOf("http") === 0) return url;
  return BASE + "/" + url.replace(/^\//, "");
}

function parseCards(html) {
  var list = [];
  var parts = html.split('class="TPostMv"');
  for (var i = 1; i < parts.length; i++) {
    var block = parts[i];
    var link = block.match(/<a[^>]*href="([^"]+)"/);
    if (!link) continue;
    var title = block.match(/<h2[^>]*class="[^"]*Title[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
    var image = block.match(/<img[^>]*src="([^"]+)"/);
    list.push({
      name: title ? text(title[1]) : "",
      alias: absolute(link[1]),
      imageUrl: image ? absolute(image[1]) : "",
    });
  }
  return list;
}

module.exports = {
  async search({ query }, api) {
    var url =
      BASE +
      "/?act=search&f[status]=all&f[keyword]=" +
      encodeURIComponent(query) +
      "&&pageNum=1";
    return parseCards(await get(api, url));
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var url = String(aliasId);
    if (url.indexOf("http") !== 0) url = BASE + url;
    var page = await get(api, url);

    var idMatch = page.match(
      /id="title-detail-manga"[^>]*data-manga="([^"]+)"/
    );
    if (!idMatch) return [];
    var mangaId = idMatch[1];

    var chapters = [];
    var pageNum = 1;
    var hasNext = true;
    while (hasNext) {
      var ajax =
        BASE +
        "/?act=ajax&code=load_list_chapter&manga_id=" +
        mangaId +
        "&page_num=" +
        pageNum +
        "&chap_id=0&keyword=";
      var body = await get(api, ajax);
      var parsed = JSON.parse(body || "{}");
      var html = parsed.list_chap || "";
      var items = html.split('class="wp-manga-chapter"');
      for (var i = 1; i < items.length; i++) {
        var block = items[i];
        var link = block.match(/<a[^>]*href="([^"]+)"/);
        if (!link) continue;
        var label = text(block.match(/<a[^>]*>([\s\S]*?)<\/a>/)[1]);
        chapters.push({
          episodeLink: absolute(link[1]),
          episodeNumber: chapters.length + 1,
          episodeTitle: label,
        });
      }
      var next = parsed.nav && parsed.nav.indexOf("page-link next") !== -1;
      if (!next) hasNext = false;
      else pageNum += 1;
      if (pageNum > 200) hasNext = false;
    }
    chapters.reverse();
    var numbered = [];
    for (var j = 0; j < chapters.length; j++) {
      numbered.push({
        episodeLink: chapters[j].episodeLink,
        episodeNumber: j + 1,
        episodeTitle: chapters[j].episodeTitle,
      });
    }
    return numbered;
  },

  async getStreams({ episodeId }, api) {
    var url = String(episodeId);
    if (url.indexOf("http") !== 0) url = BASE + url;
    var page = await get(api, url);
    var iframe = page.match(/<iframe[^>]*src="([^"]+)"/);
    if (!iframe) return [];
    var stream = iframe[1].replace("/embed/", "/anime/").trim();
    return [{ quality: "Auto", url: absolute(stream), server: "AnimeZZ" }];
  },
};
