import {NextResponse} from "next/server";
import {z} from "zod";
import {requireUser,errorResponse} from "@/lib/auth/server";
import {loadDealForMember} from "@/lib/deals/access";
import {assertSameOrigin,apiError,limit,HttpError} from "@/lib/payments/http";
import {publicSession,takeTurn} from "@/lib/negotiation/service";
import {selfChatSchema} from "@/lib/negotiation/schemas";

const emptyBody=z.object({}).strict();
const keySchema=z.string().uuid();
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  assertSameOrigin(req);
  const user=await requireUser(),{id}=await params,{deal}=await loadDealForMember(id,user);
  limit(`neg-turn:${user.id}:${id}`,8,60_000);
  const requestId=keySchema.safeParse(req.headers.get("idempotency-key"));
  if(!requestId.success)throw new HttpError(400,"idempotency_required","A valid Idempotency-Key is required.");
  const state=await publicSession(id,user.id);if(!state)throw new HttpError(409,"not_started","Start negotiation first.");
  const body=await req.json().catch(()=>null);
  let buyerText:string|undefined;
  if(state.round>=5){if(!emptyBody.safeParse(body).success)throw new HttpError(400,"invalid_body","Invalid closing request.");}
  else if(state.mode==="self_chat"){
   if(user.id!==deal.buyer_id)throw new HttpError(403,"forbidden","Only the buyer may message the seller agent.");
   const parsed=selfChatSchema.safeParse(body);if(!parsed.success)throw new HttpError(400,"invalid_body","Enter a message up to 500 characters.");
   buyerText=parsed.data.text;
  }else if(!emptyBody.safeParse(body).success)throw new HttpError(400,"invalid_body","Invalid agent-turn request.");
  const result=await takeTurn({deal,dealId:id,userId:user.id,requestId:requestId.data,buyerText});
  return NextResponse.json({result,negotiation:await publicSession(id,user.id)});
 }catch(e){return apiError(e);}
}
