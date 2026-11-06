var WEB = "https://www.animeparadise.moe";
var API = "https://api.animeparadise.moe";
var STREAM = "https://stream.animeparadise.moe";

async function get(api, url) {
  var res = await api.request({ url: url });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("AnimeParadise: HTTP " + (res && res.statusCode));
  }
  return res.body;
}

function nextData(html) {
  var match = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  return JSON.parse(match[1]);
}

function slugFromAlias(alias) {
  var value = String(alias);
  var prefix = WEB + "/anime/";
  if (value.indexOf(prefix) === 0) return value.slice(prefix.length);
  return value;
}

module.exports = {
  async search({ query }, api) {
    var body = await get(
      api,
      API + "/search?q=" + encodeURIComponent(query) + "&year=&season=&genre%5B%5D="
    );
    var doc = JSON.parse(body || "{}");
    var data = doc.data || [];
    var list = [];
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      list.push({
        name: item.title,
        alias: item.link,
        imageUrl:
          item.posterImage && item.posterImage.original
            ? item.posterImage.original
            : "",
      });
    }
    return list;
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var slug = slugFromAlias(aliasId);
    var detailBody = await get(api, API + "/anime/" + slug);
    var detail = JSON.parse(detailBody || "{}").data;
    var id = detail && detail._id ? detail._id : slug;
    var body = await get(api, API + "/anime/" + id + "/episode");
    var episodes = JSON.parse(body || "{}").data || [];
    var chapters = [];
    for (var i = 0; i < episodes.length; i++) {
      var ep = episodes[i];
      chapters.push({
        episodeLink: ep.uid + "?origin=" + ep.origin,
        episodeNumber: ep.number,
        episodeTitle: ep.title,
        thumbnail: ep.image,
      });
    }
    chapters.reverse();
    return chapters;
  },

  async getStreams({ episodeId }, api) {
    var page = await get(api, WEB + "/watch/" + episodeId);
    var data = nextData(page);
    var episode =
      data && data.props && data.props.pageProps
        ? data.props.pageProps.episode
        : null;
    if (!episode || !episode.streamLink) return [];

    var master = STREAM + "/m3u8?url=" + encodeURIComponent(episode.streamLink);
    var streams = [{ quality: "Auto", url: master }];

    var playlist = await get(api, master);
    var lines = playlist.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("#EXT-X-STREAM-INF:") === 0) {
        var resolution = lines[i].match(/RESOLUTION=(\d+x\d+)/);
        streams.push({
          quality: resolution ? resolution[1] : "Auto",
          url: STREAM + lines[i + 1].trim(),
          server: "AnimeParadise",
        });
      }
    }
    return streams;
  },
};
