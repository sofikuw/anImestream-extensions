var BASE = "https://animetsu.bz";
var PROXY = "https://swiftstream.top/proxy";

async function request(api, url) {
  var res = await api.request({
    url: url,
    headers: { Referer: BASE, "User-Agent": "MangaYomi" },
  });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("Animetsu: HTTP " + (res && res.statusCode));
  }
  return JSON.parse(res.body || "{}");
}

function titleOf(titles) {
  if (!titles) return "";
  return titles.english || titles.romaji || titles.native || "";
}

module.exports = {
  async search({ query }, api) {
    var doc = await request(
      api,
      BASE +
        "/v2/api/anime/search/?query=" +
        encodeURIComponent(query) +
        "&sort=popularity&page=1&per_page=20"
    );
    var results = doc.results || [];
    var list = [];
    for (var i = 0; i < results.length; i++) {
      var item = results[i];
      list.push({
        name: titleOf(item.title),
        alias: item.id,
        imageUrl:
          item.cover_image && item.cover_image.medium
            ? item.cover_image.medium
            : "",
      });
    }
    return list;
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var info = await request(api, BASE + "/v2/api/anime/info/" + aliasId);
    var episodes = await request(api, BASE + "/v2/api/anime/eps/" + aliasId);
    var chapters = [];
    for (var i = 0; i < episodes.length; i++) {
      var ep = episodes[i];
      chapters.push({
        episodeLink: aliasId + "/" + ep.ep_num,
        episodeNumber: ep.ep_num,
        episodeTitle: ep.name,
        isFiller: !!ep.is_filler,
        thumbnail: ep.img ? PROXY + ep.img : null,
        description: ep.desc,
      });
    }
    chapters.reverse();
    return chapters;
  },

  async getStreams({ episodeId }, api) {
    var doc = await request(
      api,
      BASE + "/v2/api/anime/oppai/" + episodeId + "?server=pahe&source_type=sub"
    );
    var sources = doc.sources || [];
    var streams = [];
    for (var i = 0; i < sources.length; i++) {
      streams.push({
        quality: String(sources[i].quality || "Auto"),
        url: PROXY + sources[i].url,
        server: "Animetsu",
      });
    }
    return streams;
  },
};
