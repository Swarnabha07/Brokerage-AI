import "server-only";
import {valueFromCents} from "@/lib/payments/money.mjs";
export function safePublicText(text:unknown,privateCents:number[]){if(typeof text!=="string")return null;const v=text.trim(),l=v.toLowerCase();if(!v||v.length>500||/[0-9$€£]/.test(v))return null;if(["system prompt","developer message","buyer maximum","seller floor","private limit"].some(x=>l.includes(x)))return null;if(privateCents.some(c=>Number.isSafeInteger(c)&&c>0&&v.includes(valueFromCents(c))))return null;return v;}
export function safeFallback(role:"buyer_agent"|"seller_agent",_cents:number){return role==="buyer_agent"?"The buyer agent has submitted its current offer for review.":"The seller agent has submitted its current offer for review.";}
