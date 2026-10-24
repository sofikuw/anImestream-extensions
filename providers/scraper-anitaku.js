/* Non-YouTube streaming adapter for anImestream Format A.
 * Uses AniList only for title metadata; stream lookup is delegated to a source API.
 * API availability, stream rights, and player compatibility can change independently.
 */
var ANILIST = "https://graphql.anilist.co";
var ANIVEXA = "https://anivexa-api.vercel.app";
var SCRAPER = "https://fetch.n92dev.us.kg/api";
var PROVIDER = "anitaku";
var MODE = "scraper";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
function enc(x){return encodeURIComponent(String(x));}
function text(x){return x===null||x===undefined?"":String(x);}
async function request(api,url,headers){
 var r=await api.request({url:url,headers:headers||{"User-Agent":USER_AGENT,"Accept":"application/json, text/plain, */*"}});
 if(!r||typeof r.statusCode!=="number") throw new Error(PROVIDER+": invalid response");
 if(r.statusCode<200||r.statusCode>=300) throw new Error(PROVIDER+": HTTP "+r.statusCode);
 return text(r.body);
}
function parseJson(s){try{return JSON.parse(s);}catch(_){return null;}}
function getMedia(o){return o&&o.data&&o.data.Page&&Array.isArray(o.data.Page.media)?o.data.Page.media:[];}
function title(m){return text(m&&m.title&&(m.title.english||m.title.romaji||m.title.native))||"Anime";}
function mediaAlias(m){return JSON.stringify({id:m.id,title:title(m),episodes:Number(m.episodes)||0});}
function parseAlias(v){try{if(typeof v==="object"&&v)return v;return JSON.parse(String(v||"{}"));}catch(_){return {};}}
function qualityFrom(url,obj){var s=text(obj&&(obj.quality||obj.label||obj.resolution));if(!s)s=(/1080p/i.test(url)?"1080p":/720p/i.test(url)?"720p":/480p/i.test(url)?"480p":"Auto");return s;}
function collectStreams(obj,out,seen){
 if(!obj)return;
 if(typeof obj==="string"){
  if(/^https?:\/\//i.test(obj)&&(/\.(m3u8|mp4|mpd|mkv)(?:[?#]|$)/i.test(obj))&&!seen[obj]){seen[obj]=1;out.push({url:obj,quality:qualityFrom(obj,null),server:PROVIDER});}
  return;
 }
 if(Array.isArray(obj)){for(var i=0;i<obj.length;i++)collectStreams(obj[i],out,seen);return;}
 if(typeof obj!=="object")return;
 var url=text(obj.url||obj.file||obj.src||obj.link||obj.streamUrl||obj.stream_url);
 if(/^https?:\/\//i.test(url)&&(/\.(m3u8|mp4|mpd|mkv)(?:[?#]|$)/i.test(url)||obj.isM3U8||obj.type==="hls")&&!seen[url]){
  seen[url]=1;out.push({url:url,quality:qualityFrom(url,obj),server:text(obj.server||obj.name||PROVIDER),customHeaders:obj.headers||obj.customHeaders||undefined});
 }
 for(var k in obj){if(Object.prototype.hasOwnProperty.call(obj,k)&&k!=="url"&&k!=="file"&&k!=="src"&&k!=="link")collectStreams(obj[k],out,seen);}
}
module.exports={
 async search(input,api){
  var q=text(input&&input.query).trim();if(!q)return[];
  var gql='query { Page(page:1,perPage:25) { media(search:"'+q.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'",type:ANIME,sort:SEARCH_MATCH) { id episodes title { english romaji native } coverImage { large } } } }';
  var url=ANILIST+"?query="+enc(gql);
  var j=parseJson(await request(api,url,{"User-Agent":USER_AGENT,"Accept":"application/json"}));
  return getMedia(j).map(function(m){return {name:title(m),alias:mediaAlias(m),imageUrl:m.coverImage&&m.coverImage.large||undefined};});
 },
 async getAnimeEpisodeLink(input,api){
  var m=parseAlias(input&&input.aliasId);if(!m.id)return[];
  var total=Number(m.episodes)||0;if(total<1||total>1000)total=24;
  var out=[];for(var i=1;i<=total;i++)out.push({episodeLink:String(m.id)+"|"+i,episodeNumber:i,episodeTitle:"Episode "+i,metadata:JSON.stringify({id:Number(m.id),episode:i,title:text(m.title)})});
  return out;
 },
 async getStreams(input,api){
  var ep=text(input&&input.episodeId);var meta=parseAlias(input&&input.metadata);var id=Number(meta.id)||0, n=Number(meta.episode)||0;
  if(!id||!n){var p=ep.split("|");id=Number(p[0])||0;n=Number(p[1])||0;}
  if(!id||!n)return[];
  var lang=input&&input.dub?"dub":"sub";var raw="";
  if(MODE==="anivexa"){
   var path=ANIVEXA+"/watch/"+enc(PROVIDER)+"/"+id+"/"+lang+"/"+enc(PROVIDER+"-"+n);
   try{raw=await request(api,path);}catch(e){return[];}
  } else {
   var path2=SCRAPER+"?action=batch_scrape&anilistId="+id+"&episode="+n+"&source="+enc(PROVIDER)+"&lang="+lang;
   try{raw=await request(api,path2);}catch(e){return[];}
  }
  var j=parseJson(raw),out=[],seen={};
  if(j)collectStreams(j,out,seen);
  if(!out.length&&/^https?:\/\//i.test(raw.trim()))collectStreams(raw.trim(),out,seen);
  return out;
 }
};
