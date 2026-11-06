var API = "https://api.animeonsen.xyz";
var AUTH = "https://auth.animeonsen.xyz";
var SEARCH = "https://search.animeonsen.xyz";
var BROWSER_TOKEN =
  "0e36d0275d16b40d7cf153634df78bc229320d073f565db2aaf6d027e0c30b13";
var cachedToken = null;

async function rawRequest(api, url, method, headers, body) {
  var res = await api.request({
    url: url,
    method: method || "GET",
    headers: headers || {},
    body: body,
  });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error("Animeonsen: HTTP " + (res && res.statusCode));
  }
  return res.body;
}

async function token(api) {
  if (cachedToken) return cachedToken;
  var body = JSON.stringify({
    client_id: "f296be26-28b5-4358-b5a1-6259575e23b7",
    client_secret:
      "349038c4157d0480784753841217270c3c5b35f4281eaee029de21cb04084235",
    grant_type: "client_credentials",
  });
  var doc = JSON.parse(
    await rawRequest(
      api,
      AUTH + "/oauth/token",
      "POST",
      { "content-type": "application/json" },
      body
    )
  );
  cachedToken = doc.access_token;
  return cachedToken;
}

async function apiGet(api, slug) {
  var bearer = await token(api);
  var body = await rawRequest(api, API + "/v4/content" + slug, "GET", {
    Authorization: "Bearer " + bearer,
    "content-type": "application/json",
  });
  return JSON.parse(body || "{}");
}

module.exports = {
  async search({ query }, api) {
    var body = JSON.stringify({ limit: 30, offset: 0, q: query });
    var doc = JSON.parse(
      await rawRequest(
        api,
        SEARCH + "/indexes/content/search",
        "POST",
        {
          Authorization: "Bearer " + BROWSER_TOKEN,
          "content-type": "application/json",
        },
        body
      )
    );
    var hits = doc.hits || [];
    var list = [];
    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i];
      list.push({
        name: hit.content_title_en || hit.content_title,
        alias: hit.content_id,
        imageUrl: API + "/v4/image/420x600/" + hit.content_id,
      });
    }
    return list;
  },

  async getAnimeEpisodeLink({ aliasId }, api) {
    var id = String(aliasId);
    var episodes = await apiGet(api, "/" + id + "/episodes");
    var chapters = [];
    var keys = Object.keys(episodes || {});
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var ep = episodes[key];
      chapters.push({
        episodeLink: "/" + id + "/video/" + key,
        episodeNumber: parseInt(key, 10),
        episodeTitle:
          ep.contentTitle_episode_en ||
          ep.contentTitle_episode_jp ||
          "Episode " + key,
      });
    }
    chapters.reverse();
    return chapters;
  },

  async getStreams({ episodeId }, api) {
    var doc = await apiGet(api, episodeId);
    var uri = doc.uri || {};
    if (!uri.stream) return [];
    return [{ quality: "Default (720p)", url: uri.stream, server: "Animeonsen" }];
  },
};
