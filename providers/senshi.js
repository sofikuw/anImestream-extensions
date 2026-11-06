var BASE = "https://senshi.live";

function headers() {
  return { Referer: BASE, Origin: BASE, "User-Agent": "MangaYomi" };
}

async function request(api, url, method, body) {
  var res = await api.request({
    url: url,
    method: method || "GET",
    headers: headers(),
    body: body,
  });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("Senshi: HTTP " + (res && res.statusCode));
  }
  return JSON.parse(res.body || "{}");
}

function itemToResult(item) {
  var anime = item.anime ? item.anime : item;
  var romaji = anime.title;
  var english = anime.title_english != null ? anime.title_english : romaji;
  return {
    name: english,
    alias: String(anime.public_id),
    imageUrl: anime.anime_picture ? BASE + anime.anime_picture : "",
  };
}

module.exports = {
  async search({ query }, api) {
    var body = JSON.stringify({
      searchTerm: query,
      page: "1",
      limit: "30",
      sortBy: "score_desc",
    });
    var doc = await request(api, BASE + "/anime/filter", "POST", body);
    var data = doc.data || [];
    var list = [];
    for (var i = 0; i < data.length; i++) list.push(itemToResult(data[i]));
    return list;
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var detail = await request(api, BASE + "/anime/" + aliasId);
    var animeId = detail.id;
    var chapters = [];
    if (detail.type === "Movie") {
      chapters.push({
        episodeLink: animeId + "/1",
        episodeNumber: 1,
        episodeTitle: "Movie",
      });
    } else {
      var episodes = await request(api, BASE + "/episodes/" + animeId);
      for (var i = 0; i < episodes.length; i++) {
        var ep = episodes[i];
        chapters.push({
          episodeLink: animeId + "/" + ep.ep_id,
          episodeNumber: ep.ep_id,
          episodeTitle: ep.ep_title || "",
          isFiller: !!(ep.ep_filler || ep.ep_recap),
        });
      }
    }
    chapters.reverse();
    return chapters;
  },

  async getStreams({ episodeId }, api) {
    var list = await request(api, BASE + "/episode-embeds/" + episodeId);
    var streams = [];
    for (var i = 0; i < list.length; i++) {
      streams.push({
        quality: list[i].status || "Auto",
        url: list[i].url,
        server: "Senshi",
      });
    }
    return streams;
  },
};
