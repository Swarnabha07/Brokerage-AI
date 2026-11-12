import {NextResponse} from "next/server";
import {z} from "zod";
import {requireUser} from "@/lib/auth/server";
import {loadDealForMember} from "@/lib/deals/access";
import {assertSameOrigin,apiError,limit,HttpError} from "@/lib/payments/http";
import {getPaymentsConfig} from "@/lib/payments/config";
import {parsePriceToCents} from "@/lib/payments/money.mjs";
import {negotiationRpc,publicSession} from "@/lib/negotiation/service";
import {startNegotiationSchema} from "@/lib/negotiation/schemas";

export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requireUser(),{id}=await params;await loadDealForMember(id,user);
  return NextResponse.json({negotiation:await publicSession(id,user.id)});
 }catch(e){return apiError(e);}
}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  assertSameOrigin(req);
  const user=await requireUser("buyer"),{id}=await params;
  const {deal,side}=await loadDealForMember(id,user);if(side!=="buyer")throw new HttpError(403,"forbidden","Buyer access required.");
  limit(`neg-start:${user.id}:${id}`,3,60_000);
  const input=startNegotiationSchema.safeParse(await req.json().catch(()=>null));
  if(!input.success)throw new HttpError(400,"invalid_body","Enter a valid buyer maximum.");
  const cents=parsePriceToCents(input.data.buyerMaximum);
  if(cents===null||cents<=0||cents>100_000_000)throw new HttpError(400,"invalid_budget","Enter a maximum from $0.01 to $1,000,000.00.");
  const cfg=getPaymentsConfig();
  await negotiationRpc("fn_neg_start",{p_deal_id:id,p_buyer_id:user.id,p_buyer_max_cents:cents,p_min_deal_cents:cfg.minDealCents});
  return NextResponse.json({negotiation:await publicSession(id,user.id)},{status:201});
 }catch(e){return apiError(e);}
}
