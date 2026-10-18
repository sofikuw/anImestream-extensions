/**
 * HiAnime — experimental anImestream anime provider.
 * Supports search, episode discovery, and direct media links where exposed by
 * the source page. Embedded-only or protected players may return no streams.
 */
var BASE="https://hianime.to";
function dec(s){return String(s||"").replace(/&amp;/g,"&").replace(/&#0?39;/g,"'").replace(/&quot;/g,'"').replace(/&#x([0-9a-f]+);/ig,function(_,n){return String.fromCharCode(parseInt(n,16));});}
function txt(s){return dec(String(s||"").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();}
function abs(u){if(!u)return"";if(u.indexOf("http")===0)return u;if(u.indexOf("//")===0)return"https:"+u;return BASE+(u.charAt(0)==="/"?u:"/"+u);}
function req(api,url){return api.request({url:url,headers:{"User-Agent":"Mozilla/5.0"}}).then(function(r){if(r.statusCode<200||r.statusCode>=300)throw new Error("HiAnime HTTP "+r.statusCode);return r.body;});}
function anchors(body, filter){var re=/<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi,m,out=[],seen={};while((m=re.exec(body))!==null){var u=abs(m[2]),label=txt(m[3]);if(!label||!filter.test(u)||seen[u])continue;seen[u]=1;out.push({url:u,title:label});}return out;}
module.exports={
 async search(input,api){var q=input&&input.query?String(input.query):"";if(!q)return[];var body=await req(api,BASE+"/search?keyword="+encodeURIComponent(q));var rows=anchors(body,/\/category\/|\/watch\/|\/anime\/|\/series\//i);return rows.slice(0,60).map(function(x){return{name:x.title,alias:x.url,imageUrl:undefined};});},
 async getAnimeEpisodeLink(input,api){var id=input&&input.aliasId?String(input.aliasId):"";if(!id)return[];var body=await req(api,id);var rows=anchors(body,/\/watch\/|\/episode\//i);var out=[];for(var i=0;i<rows.length;i++){var label=rows[i].title;var n=/(?:episode|ep)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(label)||/([0-9]+(?:\.[0-9]+)?)/.exec(label);out.push({episodeLink:rows[i].url,episodeNumber:n?Number(n[1]):i+1,episodeTitle:label});}return out;},
 async getStreams(input,api){var id=input&&input.episodeId?String(input.episodeId):"";if(!id)return[];var body=await req(api,id),out=[],seen={},re=/(?:src|data-src|file)\s*[:=]\s*["']([^"']+)["']/gi,m;while((m=re.exec(body))!==null){var u=abs(m[1].replace(/&amp;/g,"&"));if(!/^https?:/i.test(u)||! /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(u)||seen[u])continue;seen[u]=1;out.push({quality:"Auto",url:u,server:"HiAnime",customHeaders:{Referer:id}});}return out;}
};
