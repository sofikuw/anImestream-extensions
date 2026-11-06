var BASE = "https://nhentai.net";
var IMG = "https://i.nhentai.net";

async function get(api, url) {
  var res = await api.request({
    url: url,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("NHentai: HTTP " + (res && res.statusCode));
  }
  return JSON.parse(res.body || "{}");
}

module.exports = {
  async getChapters({ title }, api) {
    var doc = await get(
      api,
      BASE + "/api/v2/search?query=" + encodeURIComponent(title) + "&page=1"
    );
    var results = doc.result || [];
    var chapters = [];
    for (var i = 0; i < results.length; i++) {
      var gallery = results[i];
      chapters.push({
        chapterId: String(gallery.id),
        chapterNumber: i + 1,
        chapterTitle:
          gallery.english_title ||
          gallery.japanese_title ||
          "Gallery " + gallery.id,
        scanlator: "",
      });
    }
    return chapters;
  },

  async getPages({ chapterId }, api) {
    var gallery = await get(api, BASE + "/api/v2/galleries/" + chapterId);
    var pages = gallery.pages || [];
    var out = [];
    for (var i = 0; i < pages.length; i++) {
      out.push({
        index: i,
        url: IMG + "/" + pages[i].path,
        headers: { Referer: BASE },
      });
    }
    return out;
  },
};
