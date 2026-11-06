var BASE = "https://sudatchi.com";
var IPFS = "https://ipfs.sudatchi.com/ipfs/";

async function rawRequest(api, url, method, body) {
  var res = await api.request({
    url: url,
    method: method || "GET",
    headers: { Referer: BASE },
    body: body,
  });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("Sudatchi: HTTP " + (res && res.statusCode));
  }
  return res.body;
}

async function request(api, url, method, body) {
  return JSON.parse((await rawRequest(api, url, method, body)) || "null");
}

function toResult(details, link) {
  var titles = details.animeTitle ? details.animeTitle : details.title;
  var name = "";
  if (titles) name = titles.english || titles.romaji || titles.native || "";
  if (!name) name = details.name || "";
  var image = "";
  if (details.coverImage) image = details.coverImage;
  else if (details.imgUrl) image = IPFS + details.imgUrl;
  return { name: name, alias: String(link), imageUrl: image };
}

module.exports = {
  async search({ query }, api) {
    var doc = await request(
      api,
      BASE + "/api/search",
      "POST",
      JSON.stringify({ query: query, page: "1" })
    );
    var results = doc.results || [];
    var list = [];
    for (var i = 0; i < results.length; i++) {
      list.push(toResult(results[i], results[i].id));
    }
    return list;
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var id = String(aliasId);
    var detail = await request(api, BASE + "/api/anime/" + id);
    var episodes = detail.episodes || [];
    var chapters = [];
    if (detail.format === "MOVIE" && episodes.length > 0) {
      chapters.push({
        episodeLink: id + "/" + episodes[0].number,
        episodeNumber: episodes[0].number,
        episodeTitle: "Movie",
      });
    } else {
      for (var i = 0; i < episodes.length; i++) {
        chapters.push({
          episodeLink: id + "/" + episodes[i].number,
          episodeNumber: episodes[i].number,
          episodeTitle: episodes[i].title,
        });
      }
    }
    chapters.reverse();
    return chapters;
  },

  async getStreams({ episodeId }, api) {
    var parts = String(episodeId).split("/");
    var id = parts[0];
    var number = parts[1];
    var doc = await request(api, BASE + "/api/episode/" + id + "/" + number);
    var epId = doc.episode && doc.episode.id;
    if (!epId) return [];

    var master = BASE + "/api/streams?episodeId=" + epId;
    var body = await rawRequest(api, master);

    var streams = [{ quality: "auto", url: master }];
    var lines = String(body).split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF:") === 0) {
        var resolution = lines[i].match(/RESOLUTION=(\d+x\d+)/);
        var url = lines[i + 1].trim();
        if (url.indexOf("http") !== 0) url = BASE + url;
        streams.push({
          quality: resolution ? resolution[1] : "auto",
          url: url,
          server: "Sudatchi",
        });
      }
    }
    return streams;
  },
};
