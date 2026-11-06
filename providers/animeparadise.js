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
    // chapters.reverse();
    return chapters;
  },

  async getStreams({ episodeId }, api) {
    var raw = String(episodeId);
    var uid = raw;
    var origin = "";
    var q = raw.indexOf("?");
    if (q !== -1) {
      uid = raw.slice(0, q);
      var params = raw.slice(q + 1).split("&");
      for (var i = 0; i < params.length; i++) {
        var kv = params[i].split("=");
        if (kv[0] === "origin") origin = decodeURIComponent(kv[1] || "");
      }
    }
    var url =
      API + "/ep/" + uid + (origin ? "?origin=" + encodeURIComponent(origin) : "");
    var body = await get(api, url);
    var data = JSON.parse(body || "{}").data;
    var episode = data && data.episode ? data.episode : null;
    if (!episode || !episode.streamLink) return [];

    var master = STREAM + "/m3u8?url=" + encodeURIComponent(episode.streamLink);
    var streams = [{ quality: "Auto", url: master, server: "AnimeParadise" }];

    try {
      var playlist = await get(api, master);
      var lines = playlist.split("\n");
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].indexOf("#EXT-X-STREAM-INF:") === 0) {
          var resolution = lines[j].match(/RESOLUTION=(\d+x\d+)/);
          var next = lines[j + 1] ? lines[j + 1].trim() : "";
          if (!next) continue;
          var variant = next.indexOf("http") === 0 ? next : STREAM + next;
          streams.push({
            quality: resolution ? resolution[1] : "Auto",
            url: variant,
            server: "AnimeParadise",
          });
        }
      }
    } catch (e) {}

    return streams;
  },
};
