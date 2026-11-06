var BASE = "https://anibd.app";
var API = "https://eng.animeapps.top/api";
var PLAY = "https://playeng.animeapps.top";
var SUB_HOST = "https://ani10.nukitashi.top";

function decodeEntities(text) {
  return String(text)
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(text) {
  return decodeEntities(String(text).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

async function request(api, url) {
  var res = await api.request({ url: url });
  if (!res || typeof res.statusCode !== "number") {
    throw new Error("Anibd.App: malformed HTTP response.");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("Anibd.App: HTTP " + res.statusCode + " for " + url);
  }
  return JSON.parse(res.body || "{}");
}

async function filterAnimeList(api, slug) {
  var res = await request(api, slug);
  var list = [];
  var hasNextPage = false;
  var data = res && res.data ? res.data : [];
  var pagination = res && res.pagination ? res.pagination : {};
  var current_page = pagination.current_page || 1;
  var total_pages = pagination.total_pages || 1;
  hasNextPage = total_pages > current_page;
  for (var i = 0; i < data.length; i++) {
    var item = data[i];
    list.push({
      name: item.postname,
      imageUrl: item.ani_cover_large,
      link: String(item.postid),
    });
  }
  return { list: list, hasNextPage: hasNextPage };
}

module.exports = {
  async search({ query }, api) {
    var res = await request(api, "https://eng.animeapps.top/api/search3.php?keyword=" + encodeURIComponent(query) + "&limit=30&page=1");
    var list = [];
    if (res && res.data) {
      var data = res.data;
      for (var i = 0; i < data.length; i++) {
        var item = data[i];
        list.push({ name: item.postname, alias: String(item.postid), imageUrl: item.ani_cover_large });
      }
    }
    return list;
  },

  async getAnimeEpisodeLink({ aliasId, dub }, api) {
    var postId = String(aliasId);
    var single = await request(api, "https://eng.animeapps.top/api/single.php?postid=" + postId);
    var detail = single && single.data ? single.data : null;
    if (!detail) return [];
    var anilist = detail.anilist;
    var episodes = [];
    if (anilist) {
      var ep = await request(api, "https://eng.animeapps.top/api/api2.php?epid=" + anilist);
      var arr = ep && ep.length ? ep : (ep && ep.data ? ep.data : []);
      var isMovie = String(detail.anitypes || "").indexOf("MOVIE") !== -1;
      for (var j = 0; j < arr.length; j++) {
        var item = arr[j];
        var epName = isMovie ? "Movie" : "Episode " + item.name;
        episodes.push({ episodeLink: item.link, episodeNumber: Number(item.name), episodeTitle: epName });
      }
    }
    return episodes;
  },

  async getStreams({ episodeId, dub, metadata }, api) {
    var res = await request(api, "https://eng.animeapps.top/api/apilink.php?data=" + episodeId);
    var arr = res && res.length ? res : (res && res.data ? res.data : []);
    var streams = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var serverName = item.server;
      var embedLink = item.link;
      var linkId = embedLink.split("url=")[1] || "";
      var hasSub = embedLink.indexOf("playsub.php") !== -1;
      var cacheCode = hasSub ? "cachesub" : "cachehd";
      var streamLink = PLAY + "/r2/" + cacheCode + "/" + linkId + "/index.m3u8";
      var stream = {
        quality: serverName,
        url: streamLink,
        server: serverName,
        backup: false,
      };
      if (hasSub) {
        stream.subtitle = "English";
        stream.subtitleFormat = "vtt";
      }
      streams.push(stream);
    }
    return streams;
  },

  async getDownloadSources({ episodeUrl, dub, metadata }, api) {
    return this.getStreams({ episodeId: episodeUrl, dub: dub, metadata: metadata }, api);
  },
};
