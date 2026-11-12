import {z} from "zod";
export const startNegotiationSchema=z.object({buyerMaximum:z.union([z.string(),z.number()])}).strict();
export const selfChatSchema=z.object({text:z.string().trim().min(1).max(500)}).strict();
export const proposalReviewSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("approve"),fulfillmentType:z.enum(["physical_goods","service","other"]),deliveryExpectations:z.string().trim().min(3).max(2000),transactionConditions:z.string().trim().max(2000)}).strict(),
 z.object({action:z.literal("reject")}).strict()
]);
export const modelReplySchema=z.object({reply:z.string().trim().min(1).max(500)}).strict();
