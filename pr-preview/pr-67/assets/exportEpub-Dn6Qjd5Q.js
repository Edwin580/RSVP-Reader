import{l as e,n as t,t as n}from"./index-sBe_ETGO.js";import{t as r}from"./jszip.min-3Del06CK.js";var i=e(r(),1);async function a(e,t=new Date){let n=new i.default;n.file(`mimetype`,`application/epub+zip`,{compression:`STORE`}),n.file(`META-INF/container.xml`,`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);let r=o(e),a=`urn:chapter:${e.id}`,s=d(e.title);r.forEach((e,t)=>n.file(`OEBPS/${c(t)}`,u(e.title,e.html)));let f=e.cover?l(e.cover):null,p=f&&`cover.${f.type===`image/png`?`png`:`jpg`}`;return f&&p&&(n.file(`OEBPS/${p}`,f.data,{base64:!0}),n.file(`OEBPS/cover.xhtml`,u(e.title,`<div><img src="${p}" alt="${s}" style="max-width: 100%"/></div>`))),n.file(`OEBPS/nav.xhtml`,u(`Contents`,`<nav epub:type="toc"><h1>Contents</h1><ol>${r.map((e,t)=>`<li><a href="${c(t)}">${d(e.title)}</a></li>`).join(``)}</ol></nav>`)),n.file(`OEBPS/toc.ncx`,`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${a}"/></head>
  <docTitle><text>${s}</text></docTitle>
  <navMap>${r.map((e,t)=>`<navPoint id="nav${t}" playOrder="${t+1}"><navLabel><text>${d(e.title)}</text></navLabel><content src="${c(t)}"/></navPoint>`).join(``)}</navMap>
</ncx>`),n.file(`OEBPS/content.opf`,`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${a}</dc:identifier>
    <dc:title>${s}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${t.toISOString().replace(/\.\d+Z$/,`Z`)}</meta>${f?`
    <meta name="cover" content="cover-image"/>`:``}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${f?`\n    <item id="cover-image" href="${p}" media-type="${f.type}" properties="cover-image"/>\n    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`:``}
${r.map((e,t)=>`    <item id="s${t}" href="${c(t)}" media-type="application/xhtml+xml"/>`).join(`
`)}
  </manifest>
  <spine toc="ncx">${f?`
    <itemref idref="cover"/>`:``}
${r.map((e,t)=>`    <itemref idref="s${t}"/>`).join(`
`)}
  </spine>
</package>`),n.generateAsync({type:`arraybuffer`,mimeType:`application/epub+zip`})}function o(e){let{words:r}=e,i=new Set(e.paragraphEnds),a=new Set((e.headings??[]).map(e=>e.start)),o=e.chapters.length?e.chapters:[{title:e.title,start:0}],s=o.map(e=>e.start);return o.map(o=>{let c=n(s,o.start,r.length)-1,l=t(i,o.start,c).map(e=>{let t=a.has(e[0])?`h2`:`p`;return`<${t}>${d(e.map(e=>r[e]).join(` `))}</${t}>`}).join(`
`);return{title:o.title||e.title,html:l}})}function s(e){return`${e.replace(/[\\/:*?"<>|]+/g,` `).replace(/\s+/g,` `).trim()||`book`}.epub`}var c=e=>`section${e+1}.xhtml`;function l(e){let t=e.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);return t?{type:t[1],data:t[2]}:null}var u=(e,t)=>`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${d(e)}</title></head>
<body>
${t}
</body>
</html>`;function d(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}export{a as buildEpub,s as epubFileName};