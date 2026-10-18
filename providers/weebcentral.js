/**
 * WeebCentral — best-effort anImestream manga provider.
 * Implements the existing getChapters/getPages Format A contract.
 * Site markup can change; verify live results before relying on this provider.
 */
var BASE = "https://weebcentral.com";
function decode(s) { return String(s || "").replace(/&amp;/g,"&").replace(/&#0?39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," "); }
function text(s) { return decode(String(s || "").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim(); }
function abs(u) { if (!u) return ""; if (u.indexOf("http")===0) return u; if (u.indexOf("//")===0) return "https:"+u; return BASE + (u.charAt(0)==="/"?u:"/"+u); }
function requestBody(api, url) { return api.request({url:url, headers:{"User-Agent":"Mozilla/5.0"}}).then(function(r) { if(r.statusCode<200||r.statusCode>=300) throw new Error("WeebCentral HTTP "+r.statusCode); return r.body; }); }
function findManga(html, wanted) {
 var re=/<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi, m, rows=[], seen={};
 while((m=re.exec(html))!==null) { var url=abs(m[2]), label=text(m[3]); if(!label||label.length<2||label.length>180) continue;
   if(!/manga|series/i.test(url)) continue; if(seen[url]) continue; seen[url]=1;
   if(/chapter|genre|author|latest|login|register/i.test(label) && label.length<8) continue;
   rows.push({url:url,title:label});
 }
 var norm=function(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"");}, n=norm(wanted);
 for(var i=0;i<rows.length;i++) if(norm(rows[i].title)===n) return rows[i];
 for(var j=0;j<rows.length;j++) if(norm(rows[j].title).indexOf(n)>=0||n.indexOf(norm(rows[j].title))>=0) return rows[j];
 return rows.length?rows[0]:null;
}
function parseChapters(html) {
 var re=/<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi,m,out=[],seen={};
 while((m=re.exec(html))!==null) { var url=abs(m[2]), label=text(m[3]); if(!/chapter|\/read\//i.test(url) || !label) continue; if(seen[url]) continue; seen[url]=1;
   var n=/chapter[-\s]*(\d+(?:\.\d+)?)/i.exec(label)||/chapter[-\s]*(\d+(?:\.\d+)?)/i.exec(url)||/(\d+(?:\.\d+)?)/.exec(label);
   out.push({url:url,number:n?Number.parseFloat(n[1]):undefined,title:label});
 }
 out.sort(function(a,b){var x=a.number===undefined?-1:a.number,y=b.number===undefined?-1:b.number;return y-x;}); return out;
}
function parsePages(html, chapterUrl) {
 var re=/<img\b[^>]*>/gi,m,out=[],seen={};
 while((m=re.exec(html))!==null) { var tag=m[0], src=(/data-src=["']([^"']+)["']/i.exec(tag)||/data-lazy-src=["']([^"']+)["']/i.exec(tag)||/data-original=["']([^"']+)["']/i.exec(tag)||/src=["']([^"']+)["']/i.exec(tag));
   if(!src) continue; var url=abs(src[1]); if(!/^https?:/i.test(url)||! /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url)) continue;
   if(/logo|avatar|icon|banner|cover/i.test(url)) continue; if(seen[url]) continue; seen[url]=1; out.push({index:out.length,url:url,headers:{Referer:chapterUrl}});
 } return out;
}
module.exports={
 async getChapters(input,api) { var title=input&&input.title?String(input.title):""; if(!title)return[];
   var search=await requestBody(api,BASE + "/search?keyword=" + encodeURIComponent(title)); var manga=findManga(search,title); if(!manga)return[];
   var html=await requestBody(api,manga.url); return parseChapters(html).map(function(c){return {chapterId:c.url,chapterNumber:c.number,chapterTitle:c.title,scanlator:"WeebCentral"};});
 },
 async getPages(input,api) { var url=input&&input.chapterId?String(input.chapterId):""; if(!url)return[]; return parsePages(await requestBody(api,url),url); }
};
