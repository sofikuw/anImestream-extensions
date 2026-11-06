var BASE = "https://hanime.tv";
var SEARCH = "https://search.htv-services.com/";

function headers() {
  return {
    "Content-Type": "application/json",
    Origin: BASE,
    Referer: BASE + "/",
    "User-Agent": "Mozilla/5.0",
  };
}

async function request(api, url, method, body) {
  var res = await api.request({
    url: url,
    method: method || "GET",
    headers: headers(),
    body: body,
  });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("Hanime: HTTP " + (res && res.statusCode));
  }
  return JSON.parse(res.body || "{}");
}

module.exports = {
  async search({ query }, api) {
    var body = JSON.stringify({
      search_text: query,
      tags: [],
      tags_mode: "AND",
      brands: [],
      blacklist: [],
      order_by: "likes",
      ordering: "desc",
      page: 0,
    });
    var doc = await request(api, SEARCH, "POST", body);
    var hits = doc.hits;
    if (typeof hits === "string") hits = JSON.parse(hits);
    hits = hits || [];
    var list = [];
    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i];
      list.push({
        name: hit.name,
        alias: hit.slug,
        imageUrl: hit.cover_url || hit.poster_url || "",
      });
    }
    return list;
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var slug = String(aliasId);
    var doc = await request(api, BASE + "/api/v8/video?id=" + encodeURIComponent(slug));
    var name = doc.hentai_video ? doc.hentai_video.name : slug;
    return [{ episodeLink: slug, episodeNumber: 1, episodeTitle: name }];
  },

  async getStreams({ episodeId }, api) {
    var doc = await request(
      api,
      BASE + "/api/v8/video?id=" + encodeURIComponent(episodeId)
    );
    var servers = doc.videos_manifest ? doc.videos_manifest.servers : [];
    var streams = [];
    for (var i = 0; i < servers.length; i++) {
      var server = servers[i];
      var list = server.streams || [];
      for (var j = 0; j < list.length; j++) {
        var stream = list[j];
        streams.push({
          quality: stream.height ? stream.height + "p" : "Auto",
          url: stream.url,
          server: server.name || "Hanime",
        });
      }
    }
    return streams;
  },
};
