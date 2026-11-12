// Integer-cent interval bisection; no fixed concession percentages.
export function buyerOfferCents(ask,max){if(![ask,max].every(Number.isSafeInteger)||ask<=0||max<=0||ask>max)return null;return ask+Math.floor((max-ask)/2);}
export function sellerCounterCents(offer,ask,floor){if(![offer,ask,floor].every(Number.isSafeInteger)||offer<=0||floor<=0||ask<floor)return null;return offer>=floor?offer:floor+Math.ceil((ask-floor)/2);}
export function parseOfferCents(text){
 if(typeof text!=="string")return null;
 const number=String.raw`(\d{1,3}(?:,\d{3})*|\d{1,9})(?:\.(\d{1,2}))?`;
 const m=text.match(new RegExp(String.raw`(?<![-\d.])(?:\$\s*|USD\s*)${number}(?![\d.])|\b(?:offer|bid|price)\b\s*(?:of|at|is|:)?\s*${number}(?![\d.])`,'i'));
 if(!m)return null;
 const raw=m[1]??m[3],frac=m[2]??m[4]??"";
 const n=Number(raw.replaceAll(",",""))*100+Number(frac.padEnd(2,"0"));
 return Number.isSafeInteger(n)&&n>0&&n<=2147483647?n:null;
}
export function redactPrivateAmounts(text,values){let out=String(text??"");for(const cents of values){if(!Number.isSafeInteger(cents)||cents<=0)continue;const d=Math.floor(cents/100),f=String(cents%100).padStart(2,"0");for(const v of [`$${d}.${f}`,`$${d}`,`${d}.${f}`,String(d)].sort((a,b)=>b.length-a.length)){const e=v.replace(/[.$]/g,"\\$&");out=out.replace(new RegExp(`(?<![\\w.])${e}(?![\\w.])`,"gi"),"[private amount]");}}return out;}
