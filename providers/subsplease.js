var BASE = "https://subsplease.org";

async function get(api, url) {
  var res = await api.request({ url: url });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("SubsPlease: HTTP " + (res && res.statusCode));
  }
  return res.body;
}

function parseList(body) {
  var doc = JSON.parse(body || "{}");
  var list = [];
  for (var key in doc) {
    if (!doc.hasOwnProperty(key)) continue;
    var item = doc[key];
    list.push({
      name: item.show,
      alias: item.page,
      imageUrl: item.image_url ? BASE + item.image_url : "",
    });
  }
  return list;
}

module.exports = {
  async search({ query }, api) {
    return parseList(
      await get(api, BASE + "/api/?f=search&tz=&s=" + encodeURIComponent(query))
    );
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var slug = String(aliasId);
    var prefix = BASE + "/shows/";
    if (slug.indexOf(prefix) === 0) slug = slug.slice(prefix.length);

    var page = await get(api, BASE + "/shows/" + slug + "/");
    var match = page.match(/id="show-release-table"[^>]*\bsid="([^"]+)"/);
    if (!match) return [];

    var doc = JSON.parse(
      (await get(api, BASE + "/api/?f=show&tz=&sid=" + match[1])) || "{}"
    );
    var episodes = doc.episode || {};
    var chapters = [];
    var keys = Object.keys(episodes);
    for (var i = 0; i < keys.length; i++) {
      var ep = episodes[keys[i]];
      var numberMatch = String(ep.episode).match(/^(\d+)/);
      if (!numberMatch) continue;
      var urls = {};
      var downloads = ep.downloads || [];
      for (var j = 0; j < downloads.length; j++) {
        if (downloads[j].magnet) urls[downloads[j].res] = downloads[j].magnet;
      }
      chapters.push({
        episodeLink: JSON.stringify(urls),
        episodeNumber: parseInt(numberMatch[1], 10),
        episodeTitle: "Episode " + ep.episode,
      });
    }
    chapters.reverse();
    return chapters;
  },

  async getStreams({ episodeId }, api) {
    var urls = JSON.parse(episodeId || "{}");
    var streams = [];
    var keys = Object.keys(urls);
    for (var i = 0; i < keys.length; i++) {
      streams.push({
        quality: keys[i] + "p",
        url: urls[keys[i]],
        server: "SubsPlease",
      });
    }
    return streams;
  },
};
